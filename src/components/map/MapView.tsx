"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import {
  EyeOff,
  Focus,
  GitFork,
  LayoutGrid,
  Maximize2,
  Network,
  RotateCcw,
  Share2,
  Trash2,
  Waypoints,
  X,
} from "lucide-react";
import { buildGraph, type GraphNode } from "@/lib/graph/build";
import { pluralRu } from "@/lib/format";
import { useApp } from "@/components/state/app-state";
import { useNavigator } from "@/components/state/use-navigator";
import type { NodeMenuRequest } from "@/components/graph/GraphCanvas";
import { IconButton, cx } from "@/components/ui/primitives";
import { MapLegend } from "./MapLegend";
import { EmptyMap } from "./EmptyMap";

// Cytoscape needs `window`: load the canvas only in the browser.
const GraphCanvas = dynamic(() => import("@/components/graph/GraphCanvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-sm text-muted">Загрузка карты…</div>,
});

export function MapView() {
  const { index, state, dispatch } = useApp();
  const nav = useNavigator();
  const [menu, setMenu] = useState<NodeMenuRequest | null>(null);

  const hiddenMets = useMemo(() => new Set(state.hiddenMetaboliteIds), [state.hiddenMetaboliteIds]);
  const hiddenComps = useMemo(() => new Set(state.hiddenCompartmentIds), [state.hiddenCompartmentIds]);

  const reactionIds = useMemo(() => {
    if (hiddenComps.size === 0) return state.visibleReactionIds;
    return state.visibleReactionIds.filter((rid) => {
      const r = index.reactions.get(rid);
      return r ? r.compartmentIds.some((c) => !hiddenComps.has(c)) : false;
    });
  }, [state.visibleReactionIds, hiddenComps, index]);

  const model = useMemo(
    () =>
      buildGraph(index, reactionIds, {
        cofactorMode: state.cofactorMode,
        preferRu: state.preferRu,
        hiddenMetaboliteIds: hiddenMets,
      }),
    [index, reactionIds, state.cofactorMode, state.preferRu, hiddenMets],
  );

  const routePath = state.activeRoute?.paths[state.activeRoutePath] ?? null;

  const onSelect = useCallback(
    (n: GraphNode) => {
      setMenu(null);
      dispatch({ type: "focus", ref: { type: n.kind, id: n.refId } });
    },
    [dispatch],
  );
  const onExpand = useCallback(
    (n: GraphNode) => {
      if (n.kind === "metabolite" && !n.currency) nav.expandMetabolite(n.refId);
    },
    [nav],
  );
  const onBackgroundTap = useCallback(() => setMenu(null), []);

  const reactionCount = reactionIds.length;
  const metCount = model.nodes.filter((n) => n.kind === "metabolite" && !n.clone).length;
  const empty = state.visibleReactionIds.length === 0;

  return (
    <div className="absolute inset-0 bg-canvas" onContextMenu={(e) => e.preventDefault()}>
      <GraphCanvas
        model={model}
        focus={state.focus}
        routePath={routePath}
        quizMode={state.quizMode}
        layout={state.layout}
        layoutNonce={state.layoutNonce}
        fitNonce={state.fitNonce}
        expandAnchor={state.expandAnchor}
        onSelect={onSelect}
        onExpand={onExpand}
        onBackgroundTap={onBackgroundTap}
        onNodeMenu={setMenu}
      />

      {empty && <EmptyMap />}

      {!empty && (
        <>
          {/* context strip */}
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2">
            <div className="glass pointer-events-auto flex items-center gap-2 rounded-full py-1 pl-3.5 pr-1 text-[12px]">
              {state.mapContext.kind === "route" ? (
                <Waypoints className="h-3.5 w-3.5 text-route" />
              ) : state.mapContext.kind === "pathway" ? (
                <GitFork className="h-3.5 w-3.5 text-accent" />
              ) : (
                <Network className="h-3.5 w-3.5 text-accent" />
              )}
              <span className="max-w-[38vw] truncate font-medium">{state.mapContext.label}</span>
              <span className="tabular text-muted">
                {reactionCount} {pluralRu(reactionCount, "реакция", "реакции", "реакций")} · {metCount}{" "}
                {pluralRu(metCount, "вещество", "вещества", "веществ")}
              </span>
              <IconButton label="Очистить карту" size="sm" onClick={() => dispatch({ type: "clearMap" })}>
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>

          {/* toolbar */}
          <div className="glass absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl p-1 max-md:bottom-[calc(env(safe-area-inset-bottom)+12px)]">
            <IconButton label="Вписать в экран" onClick={() => dispatch({ type: "fit" })}>
              <Maximize2 className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Иерархическая раскладка"
              active={state.layout === "hierarchical"}
              onClick={() => dispatch({ type: "setLayout", layout: "hierarchical" })}
            >
              <LayoutGrid className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Органическая раскладка"
              active={state.layout === "organic"}
              onClick={() => dispatch({ type: "setLayout", layout: "organic" })}
            >
              <Share2 className="h-4 w-4" />
            </IconButton>
            <IconButton label="Перестроить раскладку" onClick={() => dispatch({ type: "relayout" })}>
              <RotateCcw className="h-4 w-4" />
            </IconButton>
            <div className="mx-1 h-5 w-px bg-line" />
            <IconButton
              label="Показать скрытые элементы"
              disabled={state.hiddenMetaboliteIds.length === 0 && state.hiddenCompartmentIds.length === 0}
              onClick={() => dispatch({ type: "unhideAll" })}
            >
              <EyeOff className="h-4 w-4" />
            </IconButton>
            <IconButton label="Очистить карту" onClick={() => dispatch({ type: "clearMap" })}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>

          <MapLegend model={model} />
        </>
      )}

      {menu && (
        <NodeMenu
          req={menu}
          onClose={() => setMenu(null)}
          onFocus={() => onSelect(menu.node)}
          onExpand={() => onExpand(menu.node)}
          onNeighborhood={() => nav.showNeighborhood(menu.node.refId)}
          onHide={() =>
            menu.node.kind === "metabolite"
              ? dispatch({ type: "hideMetabolite", id: menu.node.refId })
              : dispatch({ type: "removeReactions", reactionIds: [menu.node.refId] })
          }
        />
      )}
    </div>
  );
}

function NodeMenu({
  req,
  onClose,
  onFocus,
  onExpand,
  onNeighborhood,
  onHide,
}: {
  req: NodeMenuRequest;
  onClose: () => void;
  onFocus: () => void;
  onExpand: () => void;
  onNeighborhood: () => void;
  onHide: () => void;
}) {
  const isMet = req.node.kind === "metabolite";
  const item = (label: string, icon: React.ReactNode, fn: () => void, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        fn();
        onClose();
      }}
      className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] hover:bg-hover disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div
      className="glass absolute z-30 w-56 rounded-xl p-1 animate-in"
      style={{ left: Math.max(8, req.x + 8), top: Math.max(8, req.y + 8) }}
      role="menu"
    >
      <div className="truncate px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted">{req.node.label || "Реакция"}</div>
      {item("Открыть карточку", <Focus className="h-4 w-4" />, onFocus)}
      {isMet && item("Раскрыть связи", <Network className="h-4 w-4" />, onExpand, !!req.node.currency)}
      {isMet && item("Только окрестность", <Share2 className="h-4 w-4" />, onNeighborhood, !!req.node.currency)}
      {item(isMet ? "Скрыть вещество" : "Убрать реакцию", <EyeOff className="h-4 w-4" />, onHide)}
      <div className={cx("mt-1 border-t border-line pt-1")}>{item("Закрыть", <X className="h-4 w-4" />, () => {})}</div>
    </div>
  );
}
