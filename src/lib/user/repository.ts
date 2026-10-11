import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Bookmark, DifficultMark, UserDataRepository, UserNote } from "./types";

interface MetaboMapDB extends DBSchema {
  bookmarks: { key: string; value: Bookmark };
  notes: { key: string; value: UserNote };
  difficult: { key: string; value: DifficultMark };
}

/** IndexedDB-backed repository (browser only). */
export class IndexedDbRepository implements UserDataRepository {
  private db: Promise<IDBPDatabase<MetaboMapDB>>;

  constructor(name = "metabomap-user") {
    // v1: bookmarks, notes. v2 adds "difficult"; existing stores and records are kept as they are.
    this.db = openDB<MetaboMapDB>(name, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("bookmarks", { keyPath: "id" });
          db.createObjectStore("notes", { keyPath: "id" });
        }
        if (oldVersion < 2) db.createObjectStore("difficult", { keyPath: "id" });
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
  async listDifficult() {
    return (await this.db).getAll("difficult");
  }
  async putDifficult(d: DifficultMark) {
    await (await this.db).put("difficult", d);
  }
  async putAll(data: { bookmarks: Bookmark[]; notes: UserNote[]; difficult: DifficultMark[] }) {
    const db = await this.db;
    const tx = db.transaction(["bookmarks", "notes", "difficult"], "readwrite");
    await Promise.all([
      ...data.bookmarks.map((b) => tx.objectStore("bookmarks").put(b)),
      ...data.notes.map((n) => tx.objectStore("notes").put(n)),
      ...data.difficult.map((d) => tx.objectStore("difficult").put(d)),
    ]);
    await tx.done;
  }
}

/** In-memory fallback (private mode without IndexedDB, tests). Data is lost on reload. */
export class MemoryRepository implements UserDataRepository {
  private bookmarks = new Map<string, Bookmark>();
  private notes = new Map<string, UserNote>();
  private difficult = new Map<string, DifficultMark>();
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
  async listDifficult() {
    return [...this.difficult.values()];
  }
  async putDifficult(d: DifficultMark) {
    this.difficult.set(d.id, d);
  }
  async putAll(data: { bookmarks: Bookmark[]; notes: UserNote[]; difficult: DifficultMark[] }) {
    for (const b of data.bookmarks) this.bookmarks.set(b.id, b);
    for (const n of data.notes) this.notes.set(n.id, n);
    for (const d of data.difficult) this.difficult.set(d.id, d);
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
