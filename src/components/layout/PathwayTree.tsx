"use client";

import { memo, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { normalize } from "@/lib/search/search";
import { useApp } from "@/components/state/app-state";
import { MAX_REACTIONS_ON_MAP, useNavigator } from "@/components/state/use-navigator";
import { cx } from "@/components/ui/primitives";

export function PathwayTree() {
  const { index } = useApp();
  const [filter, setFilter] = useState("");
  const f = normalize(filter);

  /** pathway ids that match the filter, plus all their ancestors */
  const visibleIds = useMemo(() => {
    if (!f) return null;
    const out = new Set<string>();
    const addAncestors = (id: string) => {
      if (out.has(id)) return;
      out.add(id);
      for (const p of index.pathways.get(id)?.parentIds ?? []) addAncestors(p);
    };
    for (const p of index.dataset.pathways) {
      if (normalize(p.name).includes(f) || (p.nameRu && normalize(p.nameRu).includes(f))) addAncestors(p.id);
    }
    return out;
  }, [f, index]);

  const roots = useMemo(
    () =>
      [...index.rootPathwayIds].sort((a, b) =>
        (index.pathways.get(a)?.nameRu ?? index.pathways.get(a)?.name ?? "").localeCompare(
          index.pathways.get(b)?.nameRu ?? index.pathways.get(b)?.name ?? "",
          "ru",
        ),
      ),
    [index],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Фильтр путей"
          aria-label="Фильтр метаболических путей"
          className="h-9 w-full rounded-lg border border-line bg-panel-solid/60 px-3 text-[13px] outline-none placeholder:text-faint focus:border-accent"
        />
      </div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4" role="tree">
        {roots.map((id) => (
          <TreeNode key={id} id={id} depth={0} visibleIds={visibleIds} forceOpen={!!visibleIds} />
        ))}
      </ul>
    </div>
  );
}

const TreeNode = memo(function TreeNode({
  id,
  depth,
  visibleIds,
  forceOpen,
}: {
  id: string;
  depth: number;
  visibleIds: Set<string> | null;
  forceOpen: boolean;
}) {
  const { index, state } = useApp();
  const nav = useNavigator();
  const [open, setOpen] = useState(depth === 0 && index.rootPathwayIds.length <= 3);
  const p = index.pathways.get(id);
  if (!p) return null;
  if (visibleIds && !visibleIds.has(id)) return null;
  const count = index.pathwayReactionsDeep.get(id)?.length ?? 0;
  const children = p.subpathwayIds.filter((c) => index.pathways.has(c));
  const isOpen = forceOpen || open;
  const active = state.mapContext.kind === "pathway" && state.mapContext.refId === id;
  const focused = state.focus?.type === "pathway" && state.focus.id === id;
  const tooBig = count > MAX_REACTIONS_ON_MAP;

  return (
    <li role="treeitem" aria-expanded={children.length ? isOpen : undefined} aria-selected={active}>
      <div
        className={cx(
          "group flex min-h-9 items-center gap-1 rounded-lg pr-2 text-[13px]",
          active ? "bg-accent-soft text-accent" : focused ? "bg-hover" : "hover:bg-hover",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            aria-label={isOpen ? "Свернуть" : "Развернуть"}
            onClick={() => setOpen((o) => !o)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover"
          >
            <ChevronRight className={cx("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")} />
          </button>
        ) : (
          <span className="w-7 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => nav.openPathway(id)}
          className="min-w-0 flex-1 py-1.5 text-left"
          title={tooBig ? `${p.name}: ${count} реакций — откройте подпуть` : p.name}
        >
          <span className={cx("line-clamp-2 leading-snug", depth === 0 && "font-medium")}>{p.nameRu ?? p.name}</span>
        </button>
        <span className={cx("tabular shrink-0 text-[11px]", tooBig ? "text-faint" : "text-muted")}>{count || ""}</span>
      </div>
      {isOpen && children.length > 0 && (
        <ul role="group">
          {children.map((c) => (
            <TreeNode key={c} id={c} depth={depth + 1} visibleIds={visibleIds} forceOpen={forceOpen} />
          ))}
        </ul>
      )}
    </li>
  );
});
