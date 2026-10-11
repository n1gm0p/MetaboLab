"use client";

import { useEffect, useRef, useState } from "react";
import type { EntityRef } from "@/lib/model/types";
import { Section } from "@/components/ui/primitives";
import { useUserData } from "./user-data";

/** Personal note for an entity; saved automatically (debounced) to IndexedDB. */
export function NoteEditor({ refTo, title }: { refTo: EntityRef; title: string }) {
  const ud = useUserData();
  const existing = ud.noteFor(refTo);
  const [text, setText] = useState(existing?.text ?? "");
  const [status, setStatus] = useState<"idle" | "dirty" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<string | null>(null);

  // pick up the stored note once user data finishes loading
  useEffect(() => {
    const key = `${refTo.type}:${refTo.id}`;
    if (ud.ready && loadedFor.current !== key) {
      loadedFor.current = key;
      setText(ud.noteFor(refTo)?.text ?? "");
    }
  }, [ud, refTo]);

  const save = (value: string) => {
    ud.saveNote(refTo, title, value);
    setStatus("saved");
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Section
      title="Моя заметка"
      action={
        <span className="text-[11px] text-faint">
          {status === "dirty" ? "…" : status === "saved" ? "Сохранено" : existing ? new Date(existing.updatedAt).toLocaleDateString("ru-RU") : ""}
        </span>
      }
    >
      <textarea
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          setStatus("dirty");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => save(v), 600);
        }}
        onBlur={() => {
          if (status === "dirty") {
            if (timer.current) clearTimeout(timer.current);
            save(text);
          }
        }}
        rows={3}
        placeholder="Мнемоника, вопрос к семинару, связь с клиникой…"
        className="w-full resize-y rounded-xl border border-line bg-panel-solid/60 px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-faint focus:border-accent"
      />
    </Section>
  );
}
