"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { EntityRef } from "@/lib/model/types";
import { createRepository, MemoryRepository } from "@/lib/user/repository";
import {
  mergeRecords,
  recordKey,
  userDataExportSchema,
  type Bookmark,
  type UserDataExport,
  type UserDataRepository,
  type UserNote,
} from "@/lib/user/types";

interface UserDataValue {
  ready: boolean;
  persistent: boolean;
  bookmarks: Bookmark[];
  notes: UserNote[];
  isBookmarked: (ref: EntityRef) => boolean;
  toggleBookmark: (ref: EntityRef, title: string) => void;
  noteFor: (ref: EntityRef) => UserNote | undefined;
  saveNote: (ref: EntityRef, title: string, text: string) => void;
  exportData: () => UserDataExport;
  importData: (json: unknown) => { bookmarks: number; notes: number };
}

const UserDataContext = createContext<UserDataValue | null>(null);

export function useUserData(): UserDataValue {
  const v = useContext(UserDataContext);
  if (!v) throw new Error("useUserData must be used inside <UserDataProvider>");
  return v;
}

export function UserDataProvider({ children }: { children: React.ReactNode }) {
  const repoRef = useRef<UserDataRepository | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [ready, setReady] = useState(false);
  const [allBookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [allNotes, setNotes] = useState<UserNote[]>([]);

  useEffect(() => {
    const { repo, persistent } = createRepository();
    repoRef.current = repo;
    Promise.all([repo.listBookmarks(), repo.listNotes()])
      .then(([b, n]) => {
        setBookmarks(b);
        setNotes(n);
        setPersistent(persistent);
      })
      .catch(() => {
        // IndexedDB blocked (e.g. private mode): keep working in memory
        repoRef.current = new MemoryRepository();
        setPersistent(false);
      })
      .finally(() => setReady(true));
  }, []);

  const write = useCallback((fn: (repo: UserDataRepository) => Promise<void>) => {
    const repo = repoRef.current;
    if (repo) fn(repo).catch((err) => console.error("User data write failed", err));
  }, []);

  const bookmarks = useMemo(
    () => allBookmarks.filter((b) => !b.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [allBookmarks],
  );
  const notes = useMemo(
    () => allNotes.filter((n) => !n.deletedAt && n.text.trim()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [allNotes],
  );
  const bookmarkIds = useMemo(() => new Set(bookmarks.map((b) => b.id)), [bookmarks]);
  const notesById = useMemo(() => new Map(allNotes.filter((n) => !n.deletedAt).map((n) => [n.id, n])), [allNotes]);

  const toggleBookmark = useCallback(
    (ref: EntityRef, title: string) => {
      const id = recordKey(ref);
      const now = new Date().toISOString();
      setBookmarks((list) => {
        const cur = list.find((b) => b.id === id);
        const next: Bookmark =
          cur && !cur.deletedAt
            ? { ...cur, updatedAt: now, deletedAt: now }
            : { id, ref, title, createdAt: cur?.createdAt ?? now, updatedAt: now };
        write((repo) => repo.putBookmark(next));
        return [...list.filter((b) => b.id !== id), next];
      });
    },
    [write],
  );

  const saveNote = useCallback(
    (ref: EntityRef, title: string, text: string) => {
      const id = recordKey(ref);
      const now = new Date().toISOString();
      setNotes((list) => {
        const cur = list.find((n) => n.id === id);
        const next: UserNote = { id, ref, title, text, createdAt: cur?.createdAt ?? now, updatedAt: now };
        write((repo) => repo.putNote(next));
        return [...list.filter((n) => n.id !== id), next];
      });
    },
    [write],
  );

  const exportData = useCallback(
    (): UserDataExport => ({
      format: "metabomap-user-data",
      version: 1,
      exportedAt: new Date().toISOString(),
      bookmarks: allBookmarks,
      notes: allNotes,
    }),
    [allBookmarks, allNotes],
  );

  const importData = useCallback(
    (json: unknown) => {
      const data = userDataExportSchema.parse(json);
      const mergedB = mergeRecords(allBookmarks, data.bookmarks);
      const mergedN = mergeRecords(allNotes, data.notes);
      setBookmarks(mergedB);
      setNotes(mergedN);
      write((repo) => repo.putAll({ bookmarks: mergedB, notes: mergedN }));
      return { bookmarks: data.bookmarks.length, notes: data.notes.length };
    },
    [allBookmarks, allNotes, write],
  );

  const value = useMemo<UserDataValue>(
    () => ({
      ready,
      persistent,
      bookmarks,
      notes,
      isBookmarked: (ref) => bookmarkIds.has(recordKey(ref)),
      toggleBookmark,
      noteFor: (ref) => notesById.get(recordKey(ref)),
      saveNote,
      exportData,
      importData,
    }),
    [ready, persistent, bookmarks, notes, bookmarkIds, notesById, toggleBookmark, saveNote, exportData, importData],
  );

  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}
