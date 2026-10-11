import { z } from "zod";
import type { EntityRef } from "@/lib/model/types";

/**
 * Personal study data. Every record has `updatedAt` and soft-delete tombstones (`deletedAt`)
 * so that a future sync backend can merge devices with last-write-wins without changing the model.
 */
export interface UserRecordBase {
  /** `${type}:${entityId}` — one bookmark / one note per entity */
  id: string;
  ref: EntityRef;
  /** entity title at the time of saving (survives dataset updates) */
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type Bookmark = UserRecordBase;

/** "Difficult" mark set while studying (reactions, metabolites...). Same shape as a bookmark. */
export type DifficultMark = UserRecordBase;

export interface UserNote extends UserRecordBase {
  text: string;
}

export interface UserDataExport {
  format: "metabomap-user-data";
  version: 1;
  exportedAt: string;
  bookmarks: Bookmark[];
  notes: UserNote[];
  /** added later; optional so older export files stay valid */
  difficult?: DifficultMark[];
}

export const recordKey = (ref: EntityRef) => `${ref.type}:${ref.id}`;

const entityRef = z.object({ type: z.enum(["metabolite", "reaction", "enzyme", "pathway"]), id: z.string().min(1) });
const base = {
  id: z.string().min(1),
  ref: entityRef,
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
};

export const userDataExportSchema = z.object({
  format: z.literal("metabomap-user-data"),
  version: z.literal(1),
  exportedAt: z.string(),
  bookmarks: z.array(z.object(base)),
  notes: z.array(z.object({ ...base, text: z.string().max(200_000) })),
  difficult: z.array(z.object(base)).optional(),
});

/** Last-write-wins merge used by import (and by a future sync). */
export function mergeRecords<T extends UserRecordBase>(local: T[], incoming: T[]): T[] {
  const map = new Map(local.map((r) => [r.id, r]));
  for (const r of incoming) {
    const cur = map.get(r.id);
    if (!cur || r.updatedAt > cur.updatedAt) map.set(r.id, r);
  }
  return [...map.values()];
}

export interface UserDataRepository {
  listBookmarks(): Promise<Bookmark[]>;
  listNotes(): Promise<UserNote[]>;
  putBookmark(b: Bookmark): Promise<void>;
  putNote(n: UserNote): Promise<void>;
  listDifficult(): Promise<DifficultMark[]>;
  putDifficult(d: DifficultMark): Promise<void>;
  /** writes the merged result */
  putAll(data: { bookmarks: Bookmark[]; notes: UserNote[]; difficult: DifficultMark[] }): Promise<void>;
}
