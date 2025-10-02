import fs from 'fs';
import path from 'path';
import http from 'http';
import url from 'url';
import querystring from "querystring";


import { fetch } from '../utils/common.js';

import { PATH_ACCOUNT_JSON } from "./core.js";

const NMCL_MICROSOFT_ENTRA_APP_ID = "b0f8ad58-6580-4286-99e6-b3904832aa54";

await fs.promises.mkdir(path.dirname(NMCL_MICROSOFT_ENTRA_APP_ID), { recursive: true });

export const get_accounts = async () => {
  try {
    const stat = await fs.promises.stat(PATH_ACCOUNT_JSON);
    if (!stat.isFile()) {
      return [];
    }
  } catch {
    return [];
  }
  const accounts = JSON.parse(await fs.promises.readFile(PATH_ACCOUNT_JSON));
  return accounts;
};

export const set_accounts = async (accounts) => {
  await fs.promises.writeFile(PATH_ACCOUNT_JSON, JSON.stringify(accounts));
}




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
      console.log(`code: ${params.code}`);
      exchange_tokens(params.code);
    } else {
      res.writeCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Hello from NMCL!\nBut I am afraid something went wrong so I just gave you an empty page.');
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
const redirect_url = `http://localhost:${SERVER_PORT}/auth-redirect`;
const auth_url = `https://login.live.com/oauth20_authorize.srf?${querystring.stringify({
  client_id: NMCL_MICROSOFT_ENTRA_APP_ID,
  response_type: "code",
  redirect_uri: redirect_url,
  scope: "XboxLive.signin offline_access",
})}`;
console.log(auth_url);

const exchange_tokens = async (code) => {
  // 2. Exchange code for access + refresh tokens
  const tokenRes = await fetch("https://login.live.com/oauth20_token.srf", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: querystring.stringify({
      client_id: NMCL_MICROSOFT_ENTRA_APP_ID,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirect_url,
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

  return {
    username: profile.name,
    uuid: profile.id,
    mcAccessToken,
    refreshToken: tokenData.refresh_token,
  };

};










export const init_auth = async () => {
  return new Promise((resolve, reject) => {
    // 1. Start local server to catch redirect
    const server = http.createServer(async (req, res) => {
      if (req.url.startsWith("/callback")) {
        const url = new URL(req.url, `http://localhost:8000`);
        const code = url.searchParams.get("code");

        res.end("You can close this window now.");
        server.close();

        try {
          // 2. Exchange code for access + refresh tokens
          const tokenRes = await fetch("https://login.live.com/oauth20_token.srf", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: querystring.stringify({
              client_id: NMCL_MICROSOFT_ENTRA_APP_ID,
              code,
              grant_type: "authorization_code",
              redirect_uri: redirect_url,
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

          resolve({
            username: profile.name,
            uuid: profile.id,
            mcAccessToken,
            refreshToken: tokenData.refresh_token,
          });
        } catch (err) {
          reject(err);
        }
      }
    });

    server.listen(8000, () => {
      // 7. Open Microsoft login page
      const authUrl = `https://login.live.com/oauth20_authorize.srf?${querystring.stringify({
        client_id: NMCL_MICROSOFT_ENTRA_APP_ID,
        response_type: "code",
        redirect_uri: redirect_url,
        scope: "XboxLive.signin offline_access",
      })}`;
      open(authUrl);
    });
  });
};

