#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_OUT_DIR = path.join(ROOT, "social-agent", "out");
const DEFAULT_DATA_PATH = path.join(ROOT, "data", "social-approval-queue.json");

function parseArgs(argv) {
  const args = {
    outDir: DEFAULT_OUT_DIR,
    dataPath: DEFAULT_DATA_PATH,
    queuePath: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--queue") args.queuePath = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--data") args.dataPath = path.resolve(argv[++i]);
    else if (arg === "--help") args.help = true;
  }

  return args;
}

function printHelp() {
  console.log(`Publish the latest social approval queue for the admin dashboard.

Usage:
  node scripts/social_publish_queue.mjs
  node scripts/social_publish_queue.mjs --queue social-agent/out/social-queue-...json

Options:
  --queue <path>     Specific queue JSON to publish.
  --out-dir <path>   Queue directory. Defaults to social-agent/out.
  --data <path>      Output JSON path. Defaults to data/social-approval-queue.json.
`);
}

function latestQueuePath(outDir) {
  const entries = fs
    .readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^social-queue-.*\.json$/.test(entry.name))
    .map((entry) => {
      const filePath = path.join(outDir, entry.name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return entries[0]?.filePath || "";
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const queuePath = args.queuePath || latestQueuePath(args.outDir);
  if (!queuePath || !fs.existsSync(queuePath)) {
    throw new Error(`No social queue JSON found in ${args.outDir}. Run scripts/social_content_agent.mjs first.`);
  }

  const queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  const payload = {
    publishedAt: new Date().toISOString(),
    sourceQueueFile: path.relative(ROOT, queuePath),
    adminEmail: "triangulate.game@gmail.com",
    queue,
  };

  fs.mkdirSync(path.dirname(args.dataPath), { recursive: true });
  fs.writeFileSync(args.dataPath, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Published ${queue.ownedDrafts?.length || 0} drafts to ${args.dataPath}`);
  console.log(`Source queue: ${queuePath}`);
}

main();
