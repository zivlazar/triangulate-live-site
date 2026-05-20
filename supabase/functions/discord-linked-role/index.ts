const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DEFAULT_REDIRECT_URI = "https://triangulate.live/discord-oauth-callback/";
const STATE_COOKIE = "tri_discord_state";

function env(name: string, fallback = "") {
  return Deno.env.get(name) || fallback;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] || char));
}

function html(title: string, body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(
    `<!DOCTYPE html>
<html lang="en-GB">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #161717;
        color: #f7f2e8;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(88vw, 440px);
        padding: 32px;
        border: 1px solid rgba(247, 242, 232, 0.16);
        border-radius: 8px;
        background: #202222;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0 0 16px;
        color: #d8d0c2;
        line-height: 1.5;
      }
      a {
        color: #a7f06f;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`,
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

function redirect(location: string, headers: HeadersInit = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      Location: location,
    },
  });
}

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function setStateCookie(state: string) {
  return `${STATE_COOKIE}=${encodeURIComponent(state)}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function clearStateCookie() {
  return `${STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function buildDiscordAuthorizeUrl(state: string) {
  const clientId = env("DISCORD_CLIENT_ID");
  const redirectUri = env("DISCORD_REDIRECT_URI", DEFAULT_REDIRECT_URI);
  if (!clientId) throw new Error("Discord is not ready yet.");

  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify role_connections.write");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode(code: string) {
  const clientId = env("DISCORD_CLIENT_ID");
  const clientSecret = env("DISCORD_CLIENT_SECRET");
  const redirectUri = env("DISCORD_REDIRECT_URI", DEFAULT_REDIRECT_URI);
  if (!clientId || !clientSecret) throw new Error("Discord is not ready yet.");

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  const res = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Discord did not finish the connection.");
  }
  return String(payload.access_token);
}

async function getDiscordUser(accessToken: string) {
  const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message || "Could not read your Discord profile.");
  return payload as { username?: string; global_name?: string | null };
}

async function updateRoleConnection(accessToken: string, username: string) {
  const applicationId = env("DISCORD_APPLICATION_ID", env("DISCORD_CLIENT_ID"));
  if (!applicationId) throw new Error("Discord is not ready yet.");

  const res = await fetch(`${DISCORD_API_BASE}/users/@me/applications/${applicationId}/role-connection`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      platform_name: "Triangulate",
      platform_username: username || "Triangulate player",
      metadata: {
        triangulate_verified: "1",
      },
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message || "Discord could not save this connection.");
}

function successPage(username: string) {
  return html(
    "Triangulate connected",
    `<h1>Triangulate connected</h1>
    <p>${escapeHtml(username || "Your Discord account")} is now connected for Linked Roles.</p>
    <p>You can return to Discord and finish choosing the role.</p>
    <p><a href="https://discord.com/channels/@me">Back to Discord</a></p>`,
    200,
    { "Set-Cookie": clearStateCookie() },
  );
}

function errorPage(message: string, status = 400) {
  return html(
    "Connection not finished",
    `<h1>Connection not finished</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="https://triangulate.live/linked-role/">Try again</a></p>`,
    status,
    { "Set-Cookie": clearStateCookie() },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const route = url.searchParams.get("route") || url.pathname.split("/").filter(Boolean).at(-1) || "start";

  try {
    if (req.method !== "GET") {
      return errorPage("Please open this link in a browser.", 405);
    }

    if (route === "start" || route === "discord-linked-role") {
      const state = randomState();
      return redirect(buildDiscordAuthorizeUrl(state), { "Set-Cookie": setStateCookie(state) });
    }

    if (route === "callback") {
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const expectedState = getCookie(req, STATE_COOKIE);
      if (!code) return errorPage("Discord did not send the connection code.");
      if (!state || !expectedState || state !== expectedState) {
        return errorPage("This connection link expired. Please start again.");
      }

      const accessToken = await exchangeCode(code);
      const user = await getDiscordUser(accessToken);
      const username = user.global_name || user.username || "Triangulate player";
      await updateRoleConnection(accessToken, username);
      return successPage(username);
    }

    return redirect("https://triangulate.live/linked-role/");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discord could not finish this connection.";
    return errorPage(message, 500);
  }
});
