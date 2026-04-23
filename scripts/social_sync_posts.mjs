#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "data", "social-posts.json");

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

const fileEnv = readEnvFile(path.join(ROOT, ".env"));

function env(name, fallback = "") {
  return process.env[name] || fileEnv[name] || fallback;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    limit: Number(env("SOCIAL_POST_LIMIT", "8")) || 8,
  };
}

function firstLine(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.split(/\r?\n/)[0].slice(0, 90);
}

function summarize(value, fallback) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

async function fetchInstagramPosts(limit) {
  const token = env("INSTAGRAM_ACCESS_TOKEN");
  const userId = env("INSTAGRAM_USER_ID");
  if (!token || !userId) return [];

  const graphBase = env("INSTAGRAM_GRAPH_BASE", "https://graph.instagram.com/v22.0").replace(/\/$/, "");
  const url = new URL(`${graphBase}/${userId}/media`);
  url.searchParams.set("fields", "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username");
  url.searchParams.set("limit", String(Math.min(limit, 25)));
  url.searchParams.set("access_token", token);

  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Instagram sync failed: ${json?.error?.message || res.status}`);
  }

  return (json.data || [])
    .filter((post) => post.permalink)
    .map((post) => ({
      platform: "Instagram",
      title: firstLine(post.caption, post.media_type === "VIDEO" ? "Triangulate Reel" : "Triangulate post"),
      description: summarize(post.caption, "Latest Triangulate update from Instagram."),
      href: post.permalink,
      image: post.thumbnail_url || post.media_url || "",
      publishedAt: post.timestamp || "",
      label: post.media_type === "VIDEO" ? "Reel" : post.media_type || "Post",
    }));
}

async function fetchTikTokPosts(limit) {
  const token = env("TIKTOK_ACCESS_TOKEN");
  if (!token) return [];

  const url = new URL("https://open.tiktokapis.com/v2/video/list/");
  url.searchParams.set("fields", "id,title,video_description,cover_image_url,share_url,create_time");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ max_count: Math.min(limit, 20) }),
  });
  const json = await res.json();
  if (!res.ok || (json.error && json.error.code && json.error.code !== "ok")) {
    throw new Error(`TikTok sync failed: ${json?.error?.message || res.status}`);
  }

  return (json.data?.videos || [])
    .filter((post) => post.share_url)
    .map((post) => {
      const publishedAt = post.create_time
        ? new Date(Number(post.create_time) * 1000).toISOString()
        : "";
      const title = post.title || post.video_description || "Triangulate TikTok";
      return {
        platform: "TikTok",
        title: firstLine(title, "Triangulate TikTok"),
        description: summarize(post.video_description || post.title, "Latest Triangulate update from TikTok."),
        href: post.share_url,
        image: post.cover_image_url || "",
        publishedAt,
        label: "TikTok",
      };
    });
}

function sortPosts(posts) {
  return posts.sort((a, b) => {
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return bTime - aTime;
  });
}

const args = parseArgs(process.argv);
const [instagramPosts, tiktokPosts] = await Promise.all([
  fetchInstagramPosts(args.limit),
  fetchTikTokPosts(args.limit),
]);

const posts = sortPosts(instagramPosts.concat(tiktokPosts)).slice(0, args.limit);
const payload = {
  generatedAt: new Date().toISOString(),
  source: "official_social_apis",
  posts,
};

if (args.dryRun) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Synced ${posts.length} social posts to ${OUT_PATH}`);
}
