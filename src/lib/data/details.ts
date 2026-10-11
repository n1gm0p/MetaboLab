import { detailShardSchema } from "@/lib/model/schema";
import type { RecordDetails } from "@/lib/model/types";

/** FNV-1a 32-bit — must match scripts/import/lib/shard.mjs */
export function shardOf(id: string, shards: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % shards;
}

const shardCache = new Map<number, Promise<Record<string, RecordDetails>>>();

async function loadShard(n: number, baseUrl: string, version: string): Promise<Record<string, RecordDetails>> {
  let p = shardCache.get(n);
  if (!p) {
    p = fetch(`${baseUrl}/details/${n}.json?v=${encodeURIComponent(version)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => detailShardSchema.parse(json))
      .catch((err) => {
        shardCache.delete(n);
        throw err;
      });
    shardCache.set(n, p);
  }
  return p;
}

export async function loadDetails(
  id: string,
  shards: number,
  version: string,
  baseUrl = "/data",
): Promise<RecordDetails | null> {
  if (shards <= 0) return null;
  const shard = await loadShard(shardOf(id, shards), baseUrl, version);
  return shard[id] ?? null;
}
