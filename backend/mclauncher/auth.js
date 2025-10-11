import fs from 'fs';
import path from 'path';
import http from 'http';
import url from 'url';
import open from 'open';
import querystring from "querystring";


import { event_bridge, send } from '../app.js';
import { fetch } from '../utils/common.js';

import { mc_account_file } from './core.js';


const NMCL_MICROSOFT_ENTRA_APP_ID = "b0f8ad58-6580-4286-99e6-b3904832aa54";


// await fs.promises.mkdir(path.dirname(PATH_ACCOUNT_JSON), { recursive: true });





const read_accounts_file = async () => {
  return mc_account_file.get();
  // try {
  //   const data = await fs.promises.readFile(PATH_ACCOUNT_JSON, "utf8");

  //   if (!data.trim()) {
  //     return { next: 1, accounts: {} };
  //   }

  //   const json = JSON.parse(data);

  //   if (
  //     typeof json !== "object" ||
  //     typeof json.next !== "number" ||
  //     typeof json.accounts !== "object"
  //   ) {
  //     throw new Error("Invalid accounts.json structure");
  //   }

  //   return json;
  // } catch (err) {
  //   if (err.code === "ENOENT") {
  //     return { next: 1, accounts: {} };
  //   }
  //   throw err;
  // }
};
const write_accounts_file = async (data) => {
  mc_account_file.set(data);
  // await fs.promises.writeFile(PATH_ACCOUNT_JSON, JSON.stringify(data, null, 4), "utf8");
  const EVENT_NAME = "account_refresh_push";
  send(EVENT_NAME, null);
};

export const get_accounts = async () => {
  const data = await read_accounts_file();
  return data.accounts;
};
export const add_account = async (account) => {
  const data = await read_accounts_file();

  const id = `a-${data.next}`;
  data.accounts[id] = account;
  data.next += 1;

  await write_accounts_file(data);
};
export const update_account = async (id, account) => {
  const data = await read_accounts_file();

  if (!data.accounts[id]) {
    throw new Error(`Account with id ${id} not found`);
  }

  data.accounts[id] = {
    ...data.accounts[id],
    ...account,
  };

  await write_accounts_file(data);
};
export const remove_account = async (id) => {
  const data = await read_accounts_file();
  if (!data.accounts[id]) {
    throw new Error(`Account with id ${id} not found`);
  }
  delete data.accounts[id];
  await write_accounts_file(data);
};


const start_code_receiver_server = async () => {
  const HOST = 'localhost';
  const PORT_RANGE_START = 25566;
  const PORT_RANGE_END = 25569;

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
  // 1. Login to Microsoft
  const auth_url = `https://login.live.com/oauth20_authorize.srf?${querystring.stringify({
    client_id: NMCL_MICROSOFT_ENTRA_APP_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URL,
    prompt: "select_account",
    scope: "XboxLive.signin offline_access",
  })}`;
  open(auth_url);
};

const upon_code_received = async (code) => {
  add_account(await exchange_tokens({
    code,
    grant_type: "authorization_code",
  }));
};

export const use_account = async (id) => {
  const accounts = await get_accounts();
  const acc = accounts[id];
  if (acc.minecraft.expires_on < Math.floor(Date.now() / 1000) + 600) {
    const new_acc = await exchange_tokens({
      refresh_token: acc.microsoft.refresh_token,
      grant_type: "refresh_token",
    });
    update_account(id, new_acc);
    return new_acc.minecraft;
  } else {
    return acc.minecraft;
  }
};

const exchange_tokens = async (ms_credentials) => {

  const local_fetch_json = async (step_name, url, options) => {
    try {
      const res_json = await (await fetch(url, options)).json();
      return res_json;
    } catch (err) {
      const err2 = new Error(`Authentication failed at step ${step_name}`);
      err2.cause = err;
      console.error(err2);
      throw err2;
    }
  };

  // 2. Exchange code for access + refresh tokens
  const ms_tokens = await local_fetch_json("microsoft", "https://login.live.com/oauth20_token.srf", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: querystring.stringify({
      client_id: NMCL_MICROSOFT_ENTRA_APP_ID,
      ...ms_credentials,
      redirect_uri: REDIRECT_URL,
    }),
  });

  // 3. Authenticate with Xbox Live
  const xbox_live_data = await local_fetch_json("xbox_live", "https://user.auth.xboxlive.com/user/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${ms_tokens.access_token}`, // "d=" prefix is required
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    }),
  });

  // 4. Get XSTS token
  const xsts_data = await local_fetch_json("xsts", "https://xsts.auth.xboxlive.com/xsts/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      Properties: {
        SandboxId: "RETAIL",
        UserTokens: [xbox_live_data.Token],
      },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    }),
  });

  // 5. Get Minecraft access token
  const mc_data = await local_fetch_json("minecraft", "https://api.minecraftservices.com/authentication/login_with_xbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identityToken: `XBL3.0 x=${xsts_data.DisplayClaims.xui[0].uhs};${xsts_data.Token}`,
    }),
  });

  // 6. Get Minecraft profile (username + UUID)
  const mc_profile = await local_fetch_json("minecraft_profile", "https://api.minecraftservices.com/minecraft/profile", {
    headers: { "Authorization": `Bearer ${mc_data.access_token}` },
  });

  const res_account = {
    microsoft: {
      refresh_token: ms_tokens.refresh_token,
      expires_on: Math.floor(Date.now() / 1000) + 90 * 86400,
    },
    minecraft: {
      access_token: mc_data.access_token,
      expires_on: Math.floor(Date.now() / 1000) + mc_data.expires_in,
      username: mc_profile.name,
      uuid: mc_profile.id,
    }
  };

  return res_account;

};




event_bridge.register_members("", {
  get_accounts,
  remove_account: async ({ id }) => remove_account(id),
  open_auth_webpage,
})