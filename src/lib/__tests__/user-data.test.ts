import { describe, expect, it } from "vitest";
import { mergeRecords, recordKey, userDataExportSchema, type Bookmark } from "@/lib/user/types";
import { MemoryRepository } from "@/lib/user/repository";
import { parseHash } from "@/components/state/use-session-persistence";

const bm = (id: string, updatedAt: string, deletedAt?: string): Bookmark => ({
  id: `metabolite:${id}`,
  ref: { type: "metabolite", id },
  title: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
  deletedAt,
});

describe("personal data", () => {
  it("merges records with last-write-wins, keeping tombstones", () => {
    const local = [bm("a", "2026-01-02T00:00:00.000Z"), bm("b", "2026-01-05T00:00:00.000Z")];
    const incoming = [bm("a", "2026-01-03T00:00:00.000Z", "2026-01-03T00:00:00.000Z"), bm("b", "2026-01-04T00:00:00.000Z"), bm("c", "2026-01-01T00:00:00.000Z")];
    const merged = mergeRecords(local, incoming);
    const byId = new Map(merged.map((r) => [r.id, r]));
    expect(byId.get("metabolite:a")?.deletedAt).toBeDefined(); // newer deletion wins
    expect(byId.get("metabolite:b")?.updatedAt).toBe("2026-01-05T00:00:00.000Z"); // local is newer
    expect(byId.has("metabolite:c")).toBe(true);
  });

  it("validates the export format", () => {
    const ok = { format: "metabomap-user-data", version: 1, exportedAt: "x", bookmarks: [bm("a", "t")], notes: [] };
    expect(userDataExportSchema.safeParse(ok).success).toBe(true);
    expect(userDataExportSchema.safeParse({ ...ok, format: "other" }).success).toBe(false);
  });

  it("memory repository stores and replaces records by id", async () => {
    const repo = new MemoryRepository();
    await repo.putBookmark(bm("a", "1"));
    await repo.putBookmark(bm("a", "2"));
    expect(await repo.listBookmarks()).toHaveLength(1);
    expect(recordKey({ type: "pathway", id: "R-HSA-70171" })).toBe("pathway:R-HSA-70171");
  });

  it("parses entity links from the URL hash", () => {
    expect(parseHash("#metabolite:R-ALL-70113")).toEqual({ type: "metabolite", id: "R-ALL-70113" });
    expect(parseHash("#pathway%3AR-HSA-70171")).toEqual({ type: "pathway", id: "R-HSA-70171" });
    expect(parseHash("#foo:1")).toBeNull();
    expect(parseHash("")).toBeNull();
  });
});
