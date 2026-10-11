// FNV-1a 32-bit — must match src/lib/data/details.ts
export function shardOf(id, shards) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % shards;
}
