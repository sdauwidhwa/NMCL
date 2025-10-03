import fs from 'fs';
import path from 'path';
import http from 'http';
import url from 'url';
import open from 'open';
import querystring from "querystring";


import { event_bridge, send } from '../app.js';
import { fetch } from '../utils/common.js';


import { PATH_ACCOUNT_JSON } from "./core.js";
const NMCL_MICROSOFT_ENTRA_APP_ID = "b0f8ad58-6580-4286-99e6-b3904832aa54";

await fs.promises.mkdir(path.dirname(NMCL_MICROSOFT_ENTRA_APP_ID), { recursive: true });





const read_accounts_file = async () => {
  try {
    const data = await fs.promises.readFile(PATH_ACCOUNT_JSON, "utf8");

    if (!data.trim()) {
      // Empty file → initialize fresh structure
      return { next: 1, accounts: {} };
    }

    const json = JSON.parse(data);

    // Ensure structure validity
    if (
      typeof json !== "object" ||
      typeof json.next !== "number" ||
      typeof json.accounts !== "object"
    ) {
      throw new Error("Invalid accounts.json structure");
    }

    return json;
  } catch (err) {
    if (err.code === "ENOENT") {
      // File doesn't exist → initialize
      return { next: 1, accounts: {} };
    }
    throw err; // propagate parse errors
  }
};

const write_accounts_file = async (data) => {
  await fs.promises.writeFile(PATH_ACCOUNT_JSON, JSON.stringify(data, null, 4), "utf8");
  const EVENT_NAME = "account_refresh_push";
  send(EVENT_NAME, null);
};

export const get_accounts = async () => {
  const data = await read_accounts_file();
  return data.accounts;
};

export const use_account = async (id) => {
  const acc = await get_accounts(id);
  if (acc.expires_on < Math.floor(Date.now() / 1000)) {
    return update_account(await exchange_tokens(acc.code));
  } else {
    return acc;
  }
};

export const add_account = async (account) => {
  const data = await read_accounts_file();

  const id = `a-${data.next}`;
  data.accounts[id] = account;
  data.next += 1;

  await write_accounts_file(data);
};

export const update_account = async (account) => {
  if (!account.id) {
    throw new Error("Account must have an id to update");
  }

  const data = await read_accounts_file();

  if (!data.accounts[account.id]) {
    throw new Error(`Account with id ${account.id} not found`);
  }

  data.accounts[account.id] = {
    ...data.accounts[account.id],
    ...account,
  };

  await write_accounts_file(data);
  return data.accounts[account.id];
};

export const remove_account = async (id) => {
  const data = await read_accounts_file();
  if (!data.accounts[id]) {
    throw new Error(`Account with id ${id} not found`);
  }
  delete data.accounts[id];
  console.log(data);
  await write_accounts_file(data);
};


const upon_code_received = async (code) => {
  add_account(await exchange_tokens(code));
};

const start_code_receiver_server = async () => {
  const HOST = 'localhost';
  const PORT_RANGE_START = 25563;
  const PORT_RANGE_END = 25566;

  const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const endpoint = parsed.pathname;
    const params = parsed.query;
    if (req.method === "GET" && endpoint === "/auth-redirect" && params.code) {
      res.setHeader('Content-Type', 'text/plain');
      res.end('We have received your auth code.\nReady to proceed.');
      upon_code_received(params.code);
    } else {
      res.writeCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Hello from NMCL!\nBut I am afraid something went wrong.');
    }
  });


  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    try {
      return await new Promise((resolve, reject) => {
        server.listen(port, HOST, () => {
          console.log(`Server running at http://${HOST}:${port}/`);
          resolve(port);
        });

        server.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} is in use, trying next...`);
            reject();
          } else {
            console.error('Server failed to start:', err.message);
            reject(err);
          }
        });
      });

    } catch (err) {
      if (port === PORT_RANGE_END) {
        console.error('No available ports in range.');
        throw new Error("No available ports in range.");
      }
    }
  }
};

const SERVER_PORT = await start_code_receiver_server();
const REDIRECT_URL = `http://localhost:${SERVER_PORT}/auth-redirect`;

export const open_auth_webpage = () => {
  const auth_url = `https://login.live.com/oauth20_authorize.srf?${querystring.stringify({
    client_id: NMCL_MICROSOFT_ENTRA_APP_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URL,
    scope: "XboxLive.signin offline_access",
  })}`;
  open(auth_url);
};



const exchange_tokens = async (code) => {
  // 2. Exchange code for access + refresh tokens
  const tokenRes = await fetch("https://login.live.com/oauth20_token.srf", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: querystring.stringify({
      client_id: NMCL_MICROSOFT_ENTRA_APP_ID,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URL,
    }),
  });
  const tokenData = await tokenRes.json();
  const msAccessToken = tokenData.access_token;

  // 3. Authenticate with Xbox Live
  const xblRes = await fetch("https://user.auth.xboxlive.com/user/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msAccessToken}`, // "d=" prefix is required
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    }),
  });
  const xblData = await xblRes.json();
  const xblToken = xblData.Token;

  // 4. Get XSTS token
  const xstsRes = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      Properties: {
        SandboxId: "RETAIL",
        UserTokens: [xblToken],
      },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    }),
  });
  const xstsData = await xstsRes.json();
  const xstsToken = xstsData.Token;
  const userHash = xstsData.DisplayClaims.xui[0].uhs;

  // 5. Get Minecraft access token
  const mcRes = await fetch("https://api.minecraftservices.com/authentication/login_with_xbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identityToken: `XBL3.0 x=${userHash};${xstsToken}`,
    }),
  });
  const mcData = await mcRes.json();
  const mcAccessToken = mcData.access_token;

  // 6. Get Minecraft profile (username + UUID)
  const profileRes = await fetch("https://api.minecraftservices.com/minecraft/profile", {
    headers: { "Authorization": `Bearer ${mcAccessToken}` },
  });
  const profile = await profileRes.json();

  const res_account = {
    username: profile.name,
    uuid: profile.id,
    mcAccessToken,
    code,
    expires_on: Math.floor(Date.now() / 1000) + mcData.expires_in,
  };

  return res_account;

};




event_bridge.register_members("", {
  get_accounts,
  remove_account: async ({ id }) => remove_account(id),
  open_auth_webpage,
})