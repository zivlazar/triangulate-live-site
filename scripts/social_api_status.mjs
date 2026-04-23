#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return result;
}

function env(name, fallback = "") {
  const fileEnv = readEnvFile(path.join(ROOT, ".env"));
  return process.env[name] || fileEnv[name] || fallback;
}

async function checkInstagram() {
  const token = env("INSTAGRAM_ACCESS_TOKEN");
  const userId = env("INSTAGRAM_USER_ID");
  const graphBase = env("INSTAGRAM_GRAPH_BASE", "https://graph.instagram.com/v22.0").replace(/\/$/, "");

  if (!token || !userId) {
    return {
      ok: false,
      configured: false,
      message: "Missing INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_USER_ID.",
    };
  }

  const url = new URL(`${graphBase}/${userId}/media`);
  url.searchParams.set("fields", "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username");
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", token);

  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    configured: true,
    status: res.status,
    message: res.ok ? "Instagram media API is reachable." : json?.error?.message || "Instagram API check failed.",
  };
}

async function checkTikTok() {
  const token = env("TIKTOK_ACCESS_TOKEN");

  if (!token) {
    return {
      ok: false,
      configured: false,
      message: "Missing TIKTOK_ACCESS_TOKEN.",
    };
  }

  const url = new URL("https://open.tiktokapis.com/v2/video/list/");
  url.searchParams.set("fields", "id,title,video_description,cover_image_url,share_url,create_time");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ max_count: 1 }),
  });
  const json = await res.json().catch(() => ({}));
  return {
    ok: res.ok && json?.error?.code !== "access_token_invalid",
    configured: true,
    status: res.status,
    message: res.ok ? "TikTok video list API is reachable." : json?.error?.message || "TikTok API check failed.",
  };
}

function printResult(name, result) {
  const mark = result.ok ? "OK" : result.configured ? "FAIL" : "MISSING";
  console.log(`${name}: ${mark} - ${result.message}`);
}

const [instagram, tiktok] = await Promise.allSettled([checkInstagram(), checkTikTok()]);

const instagramResult = instagram.status === "fulfilled"
  ? instagram.value
  : { ok: false, configured: true, message: instagram.reason?.message || "Instagram check crashed." };
const tiktokResult = tiktok.status === "fulfilled"
  ? tiktok.value
  : { ok: false, configured: true, message: tiktok.reason?.message || "TikTok check crashed." };

printResult("Instagram", instagramResult);
printResult("TikTok", tiktokResult);

if (!instagramResult.ok || !tiktokResult.ok) {
  process.exitCode = 1;
}
