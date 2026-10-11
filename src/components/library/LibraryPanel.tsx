"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Flag, NotebookPen, Repeat, Star, Upload, X } from "lucide-react";
import type { EntityRef, EntityType } from "@/lib/model/types";
import { useApp } from "@/components/state/app-state";
import { useNavigator } from "@/components/state/use-navigator";
import { TYPE_LABEL } from "@/components/search/SearchBox";
import { IconButton, TextButton } from "@/components/ui/primitives";
import { useUserData } from "./user-data";

const TYPE_DOT: Record<EntityType, string> = {
  metabolite: "bg-accent",
  reaction: "bg-muted",
  enzyme: "bg-in",
  pathway: "bg-route",
};

export function LibraryPanel() {
  const { index, state, dispatch } = useApp();
  const review = state.review;
  const nav = useNavigator();
  const ud = useUserData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const exists = (type: EntityType, id: string) =>
    type === "metabolite" ? index.metabolites.has(id) : type === "reaction" ? index.reactions.has(id) : type === "enzyme" ? index.enzymes.has(id) : index.pathways.has(id);

  const download = () => {
    const blob = new Blob([JSON.stringify(ud.exportData(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `metabomap-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (file: File) => {
    try {
      const res = ud.importData(JSON.parse(await file.text()));
      setMessage(`Импортировано: закладок ${res.bookmarks}, заметок ${res.notes}, отметок «сложно» ${res.difficult}`);
    } catch {
      setMessage("Файл не похож на экспорт MetaboMap");
    }
  };

  const Item = ({ type, id, title, extra }: { type: EntityType; id: string; title: string; extra?: string }) => {
    const ok = exists(type, id);
    return (
      <li>
        <button
          type="button"
          disabled={!ok}
          onClick={() => nav.open({ type, id })}
          className="w-full rounded-lg px-2 py-2 text-left hover:bg-hover disabled:opacity-50"
          title={ok ? undefined : "Запись отсутствует в загруженной базе"}
        >
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_DOT[type]}`} />
            <span className="truncate text-[13px] font-medium">{ok ? nav.nameOf({ type, id }) : title}</span>
            <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-faint">{TYPE_LABEL[type]}</span>
          </div>
          {extra && <div className="mt-0.5 line-clamp-2 pl-3.5 text-[12px] text-muted">{extra}</div>}
        </button>
      </li>
    );
  };

  /** saved cards available in the current dataset: difficult first, then favourites */
  const reviewItems = (() => {
    const seen = new Set<string>();
    const out: EntityRef[] = [];
    for (const r of [...ud.difficult, ...ud.bookmarks]) {
      const key = `${r.ref.type}:${r.ref.id}`;
      if (seen.has(key) || !exists(r.ref.type, r.ref.id)) continue;
      seen.add(key);
      out.push(r.ref);
    }
    return out;
  })();

  const goTo = (items: EntityRef[], i: number) => {
    const ref = items[i];
    if (!ref) return;
    dispatch({ type: "setReview", review: { items, i } });
    nav.open(ref);
  };

  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-4">
      <div className="mx-1 mb-3 rounded-xl border border-line-strong p-2.5">
        {review ? (
          <div>
            <div className="flex items-center gap-1">
              <span className="tabular flex-1 text-[12px] font-medium">
                Повторение: {review.i + 1} из {review.items.length}
              </span>
              <IconButton label="Предыдущая карточка" size="sm" disabled={review.i === 0} onClick={() => goTo(review.items, review.i - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </IconButton>
              <IconButton
                label="Следующая карточка"
                size="sm"
                disabled={review.i >= review.items.length - 1}
                onClick={() => goTo(review.items, review.i + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </IconButton>
              <IconButton
                label="Закончить повторение"
                size="sm"
                onClick={() => dispatch({ type: "setReview", review: null })}
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <p className="mt-1 text-[11px] text-muted">Самопроверка включена: раскрывайте названия и ответы в карточке.</p>
          </div>
        ) : (
          <TextButton className="w-full" disabled={reviewItems.length === 0} onClick={() => goTo(reviewItems, 0)}>
            <Repeat className="h-3.5 w-3.5" /> Повторить сохранённое ({reviewItems.length})
          </TextButton>
        )}
      </div>
      {!ud.persistent && ud.ready && (
        <p className="mx-1 mb-2 rounded-lg bg-warn-soft px-2.5 py-1.5 text-[12px] text-warn">
          Хранилище браузера недоступно — заметки сохранятся только до перезагрузки.
        </p>
      )}
      <h3 className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
        <Star className="h-3.5 w-3.5" /> Избранное <span className="tabular font-normal text-faint">{ud.bookmarks.length}</span>
      </h3>
      {ud.bookmarks.length === 0 ? (
        <p className="px-2 pb-2 text-[12px] text-muted">Нажмите ☆ в карточке, чтобы сохранить вещество, реакцию или путь.</p>
      ) : (
        <ul>
          {ud.bookmarks.map((b) => (
            <Item key={b.id} type={b.ref.type} id={b.ref.id} title={b.title} />
          ))}
        </ul>
      )}

      <h3 className="mt-3 flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
        <Flag className="h-3.5 w-3.5" /> Сложные <span className="tabular font-normal text-faint">{ud.difficult.length}</span>
      </h3>
      {ud.difficult.length === 0 ? (
        <p className="px-2 pb-2 text-[12px] text-muted">Отмечайте сложные реакции флажком при прохождении пути.</p>
      ) : (
        <ul>
          {ud.difficult.map((d) => (
            <Item key={d.id} type={d.ref.type} id={d.ref.id} title={d.title} />
          ))}
        </ul>
      )}

      <h3 className="mt-3 flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
        <NotebookPen className="h-3.5 w-3.5" /> Заметки <span className="tabular font-normal text-faint">{ud.notes.length}</span>
      </h3>
      {ud.notes.length === 0 ? (
        <p className="px-2 pb-2 text-[12px] text-muted">Заметки к любой карточке хранятся локально в этом браузере.</p>
      ) : (
        <ul>
          {ud.notes.map((n) => (
            <Item key={n.id} type={n.ref.type} id={n.ref.id} title={n.title} extra={n.text} />
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-2 gap-1.5 px-1">
        <TextButton onClick={download}>
          <Download className="h-3.5 w-3.5" /> Экспорт
        </TextButton>
        <TextButton onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> Импорт
        </TextButton>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = "";
          }}
        />
      </div>
      {message && <p className="mt-2 px-2 text-[12px] text-muted">{message}</p>}
      <p className="mt-2 px-2 text-[11px] leading-snug text-faint">
        Экспорт — JSON-файл для переноса на другое устройство (например, iPad): импорт объединяет записи, более новая версия побеждает.
      </p>
    </div>
  );
}
