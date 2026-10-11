import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Bookmark, UserDataRepository, UserNote } from "./types";

interface MetaboMapDB extends DBSchema {
  bookmarks: { key: string; value: Bookmark };
  notes: { key: string; value: UserNote };
}

/** IndexedDB-backed repository (browser only). */
export class IndexedDbRepository implements UserDataRepository {
  private db: Promise<IDBPDatabase<MetaboMapDB>>;

  constructor(name = "metabomap-user") {
    this.db = openDB<MetaboMapDB>(name, 1, {
      upgrade(db) {
        db.createObjectStore("bookmarks", { keyPath: "id" });
        db.createObjectStore("notes", { keyPath: "id" });
      },
    });
  }

  async listBookmarks() {
    return (await this.db).getAll("bookmarks");
  }
  async listNotes() {
    return (await this.db).getAll("notes");
  }
  async putBookmark(b: Bookmark) {
    await (await this.db).put("bookmarks", b);
  }
  async putNote(n: UserNote) {
    await (await this.db).put("notes", n);
  }
  async putAll(data: { bookmarks: Bookmark[]; notes: UserNote[] }) {
    const db = await this.db;
    const tx = db.transaction(["bookmarks", "notes"], "readwrite");
    await Promise.all([
      ...data.bookmarks.map((b) => tx.objectStore("bookmarks").put(b)),
      ...data.notes.map((n) => tx.objectStore("notes").put(n)),
    ]);
    await tx.done;
  }
}

/** In-memory fallback (private mode without IndexedDB, tests). Data is lost on reload. */
export class MemoryRepository implements UserDataRepository {
  private bookmarks = new Map<string, Bookmark>();
  private notes = new Map<string, UserNote>();
  async listBookmarks() {
    return [...this.bookmarks.values()];
  }
  async listNotes() {
    return [...this.notes.values()];
  }
  async putBookmark(b: Bookmark) {
    this.bookmarks.set(b.id, b);
  }
  async putNote(n: UserNote) {
    this.notes.set(n.id, n);
  }
  async putAll(data: { bookmarks: Bookmark[]; notes: UserNote[] }) {
    for (const b of data.bookmarks) this.bookmarks.set(b.id, b);
    for (const n of data.notes) this.notes.set(n.id, n);
  }
}

export function createRepository(): { repo: UserDataRepository; persistent: boolean } {
  try {
    if (typeof indexedDB !== "undefined") return { repo: new IndexedDbRepository(), persistent: true };
  } catch {
    /* fall through */
  }
  return { repo: new MemoryRepository(), persistent: false };
}
