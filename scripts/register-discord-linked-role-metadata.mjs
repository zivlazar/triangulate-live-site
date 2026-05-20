const DISCORD_API_BASE = "https://discord.com/api/v10";

const applicationId = process.env.DISCORD_APPLICATION_ID || process.env.DISCORD_CLIENT_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;

if (!applicationId || !botToken) {
  console.error("Missing DISCORD_APPLICATION_ID/DISCORD_CLIENT_ID or DISCORD_BOT_TOKEN.");
  process.exit(1);
}

const metadata = [
  {
    key: "triangulate_verified",
    name: "Triangulate verified",
    description: "Has connected Triangulate to Discord.",
    type: 7,
  },
];

const res = await fetch(`${DISCORD_API_BASE}/applications/${applicationId}/role-connections/metadata`, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(metadata),
});

const payload = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(payload);
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));
