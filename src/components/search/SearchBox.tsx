"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { search, type SearchResult } from "@/lib/search/search";
import type { EntityRef, EntityType } from "@/lib/model/types";
import { compartmentName } from "@/lib/data/metabo-index";
import { useApp } from "@/components/state/app-state";
import { compartmentColor } from "@/components/graph/graph-style";
import { cx } from "@/components/ui/primitives";

export const TYPE_LABEL: Record<EntityType, string> = {
  metabolite: "Вещество",
  reaction: "Реакция",
  enzyme: "Фермент",
  pathway: "Путь",
};

const TYPE_TONE: Record<EntityType, string> = {
  metabolite: "bg-accent-soft text-accent",
  reaction: "bg-hover text-ink-2",
  enzyme: "bg-in-soft text-in",
  pathway: "bg-route-soft text-route",
};

const FILTERS: { key: EntityType | "all"; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "metabolite", label: "Вещества" },
  { key: "enzyme", label: "Ферменты" },
  { key: "pathway", label: "Пути" },
  { key: "reaction", label: "Реакции" },
];

export interface SearchBoxProps {
  onPick: (ref: EntityRef) => void;
  placeholder?: string;
  types?: EntityType[];
  autoFocus?: boolean;
  /** register Cmd/Ctrl+K and "/" shortcuts */
  globalShortcut?: boolean;
  compact?: boolean;
  showFilters?: boolean;
}

export function SearchBox({ onPick, placeholder, types, autoFocus, globalShortcut, compact, showFilters }: SearchBoxProps) {
  const { index, searchIndex } = useApp();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [filter, setFilter] = useState<EntityType | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const deferred = useDeferredValue(q);

  const results = useMemo<SearchResult[]>(() => {
    const t = filter === "all" ? types : [filter];
    return search(searchIndex, index, deferred, { limit: 40, types: t });
  }, [searchIndex, index, deferred, types, filter]);

  useEffect(() => setActive(0), [deferred, filter]);

  useEffect(() => {
    if (!globalShortcut) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [globalShortcut]);

  const pick = (ref: EntityRef) => {
    onPick(ref);
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      const r = results[active];
      if (r) pick({ type: r.type, id: r.id });
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showList = open && q.trim().length > 0;

  return (
    <div className="relative w-full">
      <div
        className={cx(
          "flex items-center gap-2 rounded-xl border border-line-strong bg-panel-solid px-3 transition-shadow focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]",
          compact ? "h-9" : "h-10",
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "Глюкоза, G6P, гексокиназа, EC 2.7.1.1, гликолиз…"}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Поиск"
          enterKeyHint="search"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {q ? (
          <button type="button" aria-label="Очистить" onClick={() => setQ("")} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          globalShortcut && <kbd className="hidden rounded-md border border-line px-1.5 text-[11px] text-faint sm:block">⌘K</kbd>
        )}
      </div>

      {showList && (
        <div
          className="glass absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-2xl animate-in"
          onMouseDown={(e) => e.preventDefault()}
        >
          {showFilters && !types && (
            <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cx(
                    "min-h-8 shrink-0 rounded-lg px-2.5 text-[12px] font-medium",
                    filter === f.key ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <ul id={listId} role="listbox" className="scroll-thin max-h-[min(60vh,480px)] overflow-y-auto p-1.5">
            {results.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">Ничего не найдено в загруженной базе</li>}
            {results.map((r, i) => (
              <li key={`${r.type}:${r.id}`} role="option" aria-selected={i === active}>
                <div
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick({ type: r.type, id: r.id })}
                  className={cx("flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5", i === active && "bg-hover")}
                >
                  <span className={cx("mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", TYPE_TONE[r.type])}>
                    {TYPE_LABEL[r.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{r.title}</div>
                    {(r.subtitle || r.matched) && (
                      <div className="truncate text-[12px] text-muted">
                        {r.matched && <span className="text-ink-2">«{r.matched}» · </span>}
                        {r.subtitle}
                      </div>
                    )}
                    {r.variantIds && r.variantIds.length > 1 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {r.variantIds.map((vid) => {
                          const m = index.metabolites.get(vid);
                          if (!m) return null;
                          return (
                            <button
                              key={vid}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                pick({ type: "metabolite", id: vid });
                              }}
                              className="inline-flex min-h-7 items-center gap-1 rounded-full border border-line px-2 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
                            >
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: compartmentColor(m.compartmentId) }} />
                              {compartmentName(index, m.compartmentId)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
