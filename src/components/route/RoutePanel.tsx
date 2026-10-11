"use client";

import { useState } from "react";
import { ArrowDownUp, ArrowRight, CornerDownRight, Loader2, Route as RouteIcon, TriangleAlert, X } from "lucide-react";
import { findRoutes, type RouteMode, type RoutePath, type RouteResult } from "@/lib/graph/route";
import { compartmentName } from "@/lib/data/metabo-index";
import { pluralRu } from "@/lib/format";
import { useApp, type RouteEndpoint } from "@/components/state/app-state";
import { useNavigator } from "@/components/state/use-navigator";
import { SearchBox } from "@/components/search/SearchBox";
import { compartmentColor } from "@/components/graph/graph-style";
import { Chip, IconButton, TextButton, cx } from "@/components/ui/primitives";

export function RoutePanel() {
  const { index, state, dispatch } = useApp();
  const [mode, setMode] = useState<RouteMode>("strict");
  const [k, setK] = useState(5);
  const [maxSteps, setMaxSteps] = useState(20);
  const [busy, setBusy] = useState(false);
  const [lastQuery, setLastQuery] = useState<string | null>(null);

  const expand = (e: RouteEndpoint) => {
    if (!e.anyCompartment) return [e.metaboliteId];
    const chebi = index.metabolites.get(e.metaboliteId)?.chebiId;
    return chebi ? (index.byChebi.get(chebi) ?? [e.metaboliteId]) : [e.metaboliteId];
  };

  const run = () => {
    const from = state.routeFrom;
    const to = state.routeTo;
    if (!from || !to) return;
    setBusy(true);
    // yield to the browser so the spinner renders before the (synchronous) search
    setTimeout(() => {
      const t0 = performance.now();
      const result = findRoutes(index, expand(from), expand(to), { mode, k, maxSteps });
      const ms = Math.round(performance.now() - t0);
      dispatch({ type: "setRoute", route: result });
      setLastQuery(`${ms} мс`);
      if (result.paths.length) {
        const reactionIds = [...new Set(result.paths.flatMap((p) => p.steps.map((s) => s.reactionId)))];
        dispatch({
          type: "showReactions",
          reactionIds,
          context: { kind: "route", label: `Маршрут: ${name(from.metaboliteId)} → ${name(to.metaboliteId)}` },
          layout: "hierarchical",
        });
      }
      setBusy(false);
    }, 16);
  };

  const name = (id: string) => {
    const m = index.metabolites.get(id);
    return m ? (state.preferRu && m.nameRu) || m.name : id;
  };

  const result = state.activeRoute;

  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4">
      <div className="space-y-2">
        <EndpointPicker label="Откуда" end="from" value={state.routeFrom} />
        <div className="flex justify-center">
          <IconButton label="Поменять местами" size="sm" onClick={() => dispatch({ type: "swapRouteEndpoints" })}>
            <ArrowDownUp className="h-4 w-4" />
          </IconButton>
        </div>
        <EndpointPicker label="Куда" end="to" value={state.routeTo} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-hover p-1">
        {(
          [
            ["strict", "Биохимический"],
            ["relaxed", "Топологический"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cx("min-h-8 rounded-lg text-[12px] font-medium", mode === m ? "bg-panel-solid text-ink shadow-sm" : "text-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted">
        {mode === "strict"
          ? "Учитывает направление реакций и компартменты: переход между компартментами возможен только через транспортную реакцию."
          : "Игнорирует направление и компартменты. Показывает лишь связность на карте — это не биохимически допустимая последовательность."}
      </p>

      <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
        <label className="flex items-center gap-1.5">
          Вариантов
          <select value={k} onChange={(e) => setK(Number(e.target.value))} className="h-8 rounded-lg border border-line bg-panel-solid px-1.5 text-ink">
            {[1, 3, 5, 10].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Макс. шагов
          <select value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))} className="h-8 rounded-lg border border-line bg-panel-solid px-1.5 text-ink">
            {[10, 20, 30, 40].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      <TextButton tone="primary" className="mt-3 w-full" disabled={!state.routeFrom || !state.routeTo || busy} onClick={run}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RouteIcon className="h-4 w-4" />}
        Найти маршрут
      </TextButton>

      {result && <RouteResults result={result} meta={lastQuery} />}
    </div>
  );
}

function EndpointPicker({ label, end, value }: { label: string; end: "from" | "to"; value: RouteEndpoint | null }) {
  const { index, dispatch } = useApp();
  const m = value ? index.metabolites.get(value.metaboliteId) : undefined;
  const variants = m?.chebiId ? (index.byChebi.get(m.chebiId) ?? []) : [];

  if (!value || !m) {
    return (
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</div>
        <SearchBox
          compact
          types={["metabolite"]}
          placeholder="Вещество…"
          onPick={(ref) => dispatch({ type: "setRouteEndpoint", end, value: { metaboliteId: ref.id, anyCompartment: false } })}
        />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-panel-solid/60 p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</div>
          <div className="truncate text-[14px] font-medium">{m.nameRu ?? m.name}</div>
        </div>
        <IconButton label="Сбросить" size="sm" onClick={() => dispatch({ type: "setRouteEndpoint", end, value: null })}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      {variants.length > 1 ? (
        <select
          aria-label="Компартмент"
          value={value.anyCompartment ? "*" : value.metaboliteId}
          onChange={(e) =>
            dispatch({
              type: "setRouteEndpoint",
              end,
              value: e.target.value === "*" ? { metaboliteId: value.metaboliteId, anyCompartment: true } : { metaboliteId: e.target.value, anyCompartment: false },
            })
          }
          className="mt-1.5 h-8 w-full rounded-lg border border-line bg-panel-solid px-2 text-[12px]"
        >
          <option value="*">Любой компартмент ({variants.length})</option>
          {variants.map((v) => (
            <option key={v} value={v}>
              {compartmentName(index, index.metabolites.get(v)?.compartmentId ?? "")}
            </option>
          ))}
        </select>
      ) : (
        <div className="mt-1 text-[12px] text-muted">{compartmentName(index, m.compartmentId)}</div>
      )}
    </div>
  );
}

function RouteResults({ result, meta }: { result: RouteResult; meta: string | null }) {
  const { state, dispatch } = useApp();
  if (result.paths.length === 0) {
    return (
      <div className="mt-4 rounded-xl bg-warn-soft p-3 text-[13px] leading-snug text-warn">
        <div className="flex items-center gap-1.5 font-medium">
          <TriangleAlert className="h-4 w-4" /> Маршрут не найден
        </div>
        <p className="mt-1">
          В пределах {result.maxSteps} шагов {result.mode === "strict" ? "с учётом направления реакций и компартментов " : ""}
          последовательность реакций в загруженной базе отсутствует.
          {result.mode === "strict" && " Попробуйте «Любой компартмент» или топологический режим, чтобы увидеть, где обрывается связь."}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between text-[11px] text-muted">
        <span className="font-semibold uppercase tracking-[0.06em]">
          {result.paths.length} {pluralRu(result.paths.length, "маршрут", "маршрута", "маршрутов")}
          {result.mode === "relaxed" && " · топологические"}
        </span>
        {meta && <span>{meta}</span>}
      </div>
      <ul className="space-y-2">
        {result.paths.map((p, i) => (
          <PathCard key={i} path={p} index={i} active={state.activeRoutePath === i} onSelect={() => dispatch({ type: "selectRoutePath", index: i })} relaxed={result.mode === "relaxed"} />
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-snug text-faint">
        Шаг «A → B» означает, что A — субстрат, а B — продукт одной реакции. Без атомного картирования это не доказывает переход атомов A в B; проверяйте косубстраты.
      </p>
    </div>
  );
}

function PathCard({ path, index: i, active, onSelect, relaxed }: { path: RoutePath; index: number; active: boolean; onSelect: () => void; relaxed: boolean }) {
  const { index, state } = useApp();
  const nav = useNavigator();
  const name = (id: string) => {
    const m = index.metabolites.get(id);
    if (!m) return id;
    const endpoint = id === path.metaboliteIds[0] || id === path.metaboliteIds.at(-1);
    if (state.quizMode && !endpoint && !m.currency) return "?";
    return (state.preferRu && m.nameRu) || m.name;
  };
  const transports = path.steps.filter((s) => index.reactions.get(s.reactionId)?.isTransport).length;
  const jumps = path.steps.filter((s) => s.compartmentJump).length;
  const preview = path.metaboliteIds.map(name).join(" → ");

  return (
    <li className={cx("rounded-xl border transition-colors", active ? "border-route bg-route-soft/40" : "border-line hover:bg-hover")}>
      <button type="button" onClick={onSelect} className="w-full px-3 pb-2 pt-2.5 text-left">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-semibold">Вариант {i + 1}</span>
          <Chip tone="route">
            {path.steps.length} {pluralRu(path.steps.length, "шаг", "шага", "шагов")}
          </Chip>
          {transports > 0 && <Chip tone="accent">транспорт: {transports}</Chip>}
          {relaxed && jumps > 0 && <Chip tone="warn">смена компартмента без транспорта: {jumps}</Chip>}
        </div>
        {!active && <div className="mt-1 line-clamp-2 text-[12px] text-muted">{preview}</div>}
      </button>
      {active && (
        <ol className="space-y-1 px-3 pb-3">
          {path.steps.map((s, si) => {
            const r = index.reactions.get(s.reactionId);
            const from = index.metabolites.get(s.fromId);
            return (
              <li key={`${s.reactionId}-${si}`} className="text-[12px]">
                {si === 0 && (
                  <div className="flex items-center gap-1.5 font-medium text-ink">
                    <span className="h-2 w-2 rounded-full" style={{ background: compartmentColor(from?.compartmentId) }} />
                    {name(s.fromId)}
                  </div>
                )}
                {s.compartmentJump && <div className="ml-1 text-[11px] text-warn">⚠ переход в другой компартмент без транспортной реакции</div>}
                <button
                  type="button"
                  onClick={() => nav.open({ type: "reaction", id: s.reactionId })}
                  className="group my-0.5 ml-1 flex w-full items-start gap-1.5 border-l-2 border-route/40 py-1 pl-2.5 text-left hover:border-route"
                >
                  <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0 text-route" />
                  <span className="min-w-0">
                    <span className="text-ink-2 group-hover:text-accent">
                      {state.quizMode ? (r?.ecNumbers[0] ? `EC ${r.ecNumbers[0]}` : "реакция") : ((state.preferRu && r?.nameRu) || r?.name)}
                    </span>
                    {s.direction === "backward" && <span className="ml-1 text-warn">(в обратном направлении)</span>}
                    {s.coSubstrates.length > 0 && (
                      <span className="block text-muted">
                        + {s.coSubstrates.map((p) => `${p.stoichiometry !== 1 ? `${p.stoichiometry} ` : ""}${name(p.metaboliteId)}`).join(", ")}
                      </span>
                    )}
                    {s.coProducts.length > 0 && (
                      <span className="block text-faint">
                        также образуется: {s.coProducts.map((p) => name(p.metaboliteId)).join(", ")}
                      </span>
                    )}
                  </span>
                </button>
                <div className="flex items-center gap-1.5 font-medium text-ink">
                  <ArrowRight className="h-3 w-3 text-route" />
                  <span className="h-2 w-2 rounded-full" style={{ background: compartmentColor(index.metabolites.get(s.toId)?.compartmentId) }} />
                  {name(s.toId)}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}
