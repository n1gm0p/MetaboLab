// Polite HTTP helper for the importer: disk cache, retries with backoff, limited concurrency.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_DIR = fileURLToPath(new URL("../.cache/", import.meta.url));
const USER_AGENT = "MetaboMap-importer/0.1 (educational, non-commercial; contact via repository)";

let active = 0;
const queue = [];
const MAX_CONCURRENCY = Number(process.env.IMPORT_CONCURRENCY ?? 4);

function acquire() {
  return new Promise((resolve) => {
    if (active < MAX_CONCURRENCY) {
      active++;
      resolve();
    } else queue.push(resolve);
  });
}
function release() {
  const next = queue.shift();
  if (next) next();
  else active--;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const stats = { network: 0, cached: 0, failed: 0 };

/**
 * Fetch JSON with an on-disk cache keyed by method+url+body.
 * Returns `null` for 404 (missing record), throws after repeated failures.
 */
export async function fetchJson(url, { method = "GET", body, headers = {}, useCache = true } = {}) {
  const key = createHash("sha1").update(`${method} ${url} ${body ?? ""}`).digest("hex");
  const file = join(CACHE_DIR, key.slice(0, 2), `${key}.json`);
  if (useCache) {
    try {
      const raw = await readFile(file, "utf8");
      stats.cached++;
      return JSON.parse(raw);
    } catch {
      /* not cached */
    }
  }
  await acquire();
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          body,
          headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers },
          signal: AbortSignal.timeout(120_000),
        });
        if (res.status === 404) {
          stats.network++;
          await persist(file, null);
          return null;
        }
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const json = await res.json();
        stats.network++;
        await persist(file, json);
        return json;
      } catch (err) {
        if (attempt === 4) {
          stats.failed++;
          throw err;
        }
        await sleep(1000 * 2 ** attempt);
      }
    }
  } finally {
    release();
  }
}

async function persist(file, json) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(json));
}

/** Run async fn over items with progress output. */
export async function mapAll(items, fn, label) {
  let done = 0;
  const out = new Array(items.length);
  await Promise.all(
    items.map(async (item, i) => {
      out[i] = await fn(item, i);
      done++;
      if (label && (done % 25 === 0 || done === items.length)) {
        process.stdout.write(`\r  ${label}: ${done}/${items.length}   `);
      }
    }),
  );
  if (label) process.stdout.write("\n");
  return out;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
