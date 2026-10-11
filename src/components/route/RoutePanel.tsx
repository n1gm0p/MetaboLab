"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, ArrowRight, CornerDownRight, Info, Loader2, Route as RouteIcon, TriangleAlert, X } from "lucide-react";
import { findRoutes, type RouteMode, type RoutePath, type RouteResult, type StepFlag } from "@/lib/graph/route";
import { compartmentName } from "@/lib/data/metabo-index";
import { pluralRu } from "@/lib/format";
import { useApp, type RouteEndpoint } from "@/components/state/app-state";
import { useNavigator } from "@/components/state/use-navigator";
import { SearchBox } from "@/components/search/SearchBox";
import { compartmentColor } from "@/components/graph/graph-style";
import { Chip, IconButton, TextButton, cx } from "@/components/ui/primitives";

const FLAG_LABEL: Record<StepFlag, { text: string; tone: "neutral" | "accent" | "warn"; hint: string }> = {
  lumped: { text: "суммарное событие", tone: "warn", hint: "Reactome описывает несколько стадий одной записью" },
  "co-substrate": { text: "нужен косубстрат", tone: "neutral", hint: "реакции требуется ещё один основной субстрат" },
  "carbon-mismatch": { text: "сомнительное сопоставление", tone: "warn", hint: "в обменной реакции число атомов C у пары не совпадает с ближайшим вариантом" },
  transport: { text: "транспорт", tone: "accent", hint: "перенос между компартментами" },
  "no-catalyst": { text: "катализатор не указан", tone: "neutral", hint: "в источнике нет катализатора; это не обязательно спонтанная реакция" },
  unbalanced: { text: "баланс не сходится", tone: "warn", hint: "по формулам ChEBI баланс элементов (без H) не сходится" },
  "class-entity": { text: "группа веществ", tone: "warn", hint: "участник — класс соединений, а не конкретное вещество" },
  "compartment-jump": { text: "без транспорта", tone: "warn", hint: "компартмент сменился без транспортной реакции (топологический режим)" },
};

export function RoutePanel() {
  const { index, state, dispatch } = useApp();
  const [mode, setMode] = useState<RouteMode>("strict");
  const [k, setK] = useState(5);
  const [maxSteps, setMaxSteps] = useState(20);
  const [scope, setScope] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [lastQuery, setLastQuery] = useState<{ ms: number; scope: string } | null>(null);

  const expand = (e: RouteEndpoint) => {
    if (!e.anyCompartment) return [e.metaboliteId];
    const chebi = index.metabolites.get(e.metaboliteId)?.chebiId;
    return chebi ? (index.byChebi.get(chebi) ?? [e.metaboliteId]) : [e.metaboliteId];
  };

  /** pathways that contain both endpoints (most specific first) */
  const commonPathways = useMemo(() => {
    if (!state.routeFrom || !state.routeTo) return [];
    const of = (e: RouteEndpoint) => {
      const ids = e.anyCompartment && index.metabolites.get(e.metaboliteId)?.chebiId
        ? (index.byChebi.get(index.metabolites.get(e.metaboliteId)!.chebiId!) ?? [])
        : [e.metaboliteId];
      return new Set(ids.flatMap((id) => index.metabolitePathways.get(id) ?? []));
    };
    const a = of(state.routeFrom);
    const b = of(state.routeTo);
    return [...a]
      .filter((p) => b.has(p) && p !== "R-HSA-1430728")
      .sort((x, y) => (index.pathwayReactionsDeep.get(x)?.length ?? 0) - (index.pathwayReactionsDeep.get(y)?.length ?? 0));
  }, [index, state.routeFrom, state.routeTo]);
  const effectiveScope = commonPathways.includes(scope) ? scope : "";

  const name = (id: string) => {
    const m = index.metabolites.get(id);
    return m ? (state.preferRu && m.nameRu) || m.name : id;
  };

  const run = () => {
    const from = state.routeFrom;
    const to = state.routeTo;
    if (!from || !to) return;
    setBusy(true);
    // yield to the browser so the spinner renders before the (synchronous) search
    setTimeout(() => {
      const t0 = performance.now();
      const allowed = effectiveScope ? new Set(index.pathwayReactionsDeep.get(effectiveScope) ?? []) : undefined;
      const result = findRoutes(index, expand(from), expand(to), { mode, k, maxSteps, allowedReactionIds: allowed });
      dispatch({ type: "setRoute", route: result });
      setLastQuery({ ms: Math.round(performance.now() - t0), scope: effectiveScope });
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

      <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-hover p-1" role="radiogroup" aria-label="Режим поиска">
        {(
          [
            ["strict", "Биохимический"],
            ["relaxed", "Топологический"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
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

      <label className="mt-3 block text-[12px] text-muted">
        В пределах пути
        <select
          value={effectiveScope}
          onChange={(e) => setScope(e.target.value)}
          disabled={commonPathways.length === 0}
          className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-panel-solid px-2 text-[12px] text-ink disabled:opacity-50"
        >
          <option value="">Вся база (любые пути)</option>
          {commonPathways.map((p) => (
            <option key={p} value={p}>
              {index.pathways.get(p)?.nameRu ?? index.pathways.get(p)?.name} ({index.pathwayReactionsDeep.get(p)?.length ?? 0})
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-[11px] leading-snug text-faint">
        {commonPathways.length
          ? "Кратчайший путь по всей базе может пройти через побочные реакции; ограничение путём Reactome даёт последовательность этого пути."
          : "Нет пути Reactome, содержащего оба вещества: поиск идёт по всей базе."}
      </p>

      <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
        <label className="flex items-center gap-1.5">
          Вариантов
          <select value={k} onChange={(e) => setK(Number(e.target.value))} className="h-8 rounded-lg border border-line-strong bg-panel-solid px-1.5 text-ink">
            {[1, 3, 5, 10].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Макс. шагов
          <select value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))} className="h-8 rounded-lg border border-line-strong bg-panel-solid px-1.5 text-ink">
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
    <div className="rounded-xl border border-line-strong bg-panel-solid p-2.5">
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

function RouteResults({ result, meta }: { result: RouteResult; meta: { ms: number; scope: string } | null }) {
  const { index, state, dispatch } = useApp();
  const scopeName = meta?.scope ? (index.pathways.get(meta.scope)?.nameRu ?? index.pathways.get(meta.scope)?.name) : null;
  if (result.paths.length === 0) {
    return (
      <div className="mt-4 rounded-xl bg-warn-soft p-3 text-[13px] leading-snug text-warn" role="status">
        <div className="flex items-center gap-1.5 font-medium">
          <TriangleAlert className="h-4 w-4" /> Маршрут не найден
        </div>
        <p className="mt-1">
          В пределах {result.maxSteps} шагов {result.mode === "strict" ? "с учётом направления реакций и компартментов " : ""}
          {scopeName ? `среди реакций пути «${scopeName}» ` : ""}
          последовательность реакций в загруженной базе отсутствует. Это не доказывает, что превращение невозможно: база Reactome неполна.
          {result.mode === "strict" && " Попробуйте «Любой компартмент», всю базу или топологический режим, чтобы увидеть, где обрывается связь."}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4" role="status">
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[11px] text-muted">
        <span className="font-semibold uppercase tracking-[0.06em]">
          {result.paths.length} {pluralRu(result.paths.length, "маршрут", "маршрута", "маршрутов")}
          {result.mode === "relaxed" && " · топологические"}
        </span>
        {meta && <span>{meta.ms} мс</span>}
      </div>
      {scopeName && <p className="mb-2 text-[11px] text-muted">Только реакции пути «{scopeName}».</p>}
      <ul className="space-y-2">
        {result.paths.map((p, i) => (
          <PathCard key={i} path={p} index={i} best={i === 0} active={state.activeRoutePath === i} onSelect={() => dispatch({ type: "selectRoutePath", index: i })} />
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-snug text-faint">
        Шаг «A → B» означает, что A — субстрат, а B — продукт одной реакции. Без атомного картирования это не доказывает переход атомов A в B; проверяйте косубстраты.
      </p>
    </div>
  );
}

function PathCard({ path, index: i, best, active, onSelect }: { path: RoutePath; index: number; best: boolean; active: boolean; onSelect: () => void }) {
  const { index, state } = useApp();
  const nav = useNavigator();
  const name = (id: string) => {
    const m = index.metabolites.get(id);
    if (!m) return id;
    const endpoint = id === path.metaboliteIds[0] || id === path.metaboliteIds.at(-1);
    if (state.quizMode && !endpoint && !m.currency) return "?";
    return (state.preferRu && m.nameRu) || m.name;
  };
  const a = path.assessment;
  const preview = path.metaboliteIds.map(name).join(" → ");
  const penalties = path.cost - path.steps.length;

  return (
    <li className={cx("rounded-xl border transition-colors", active ? "border-route bg-panel-solid" : "border-line hover:bg-hover")}>
      <button type="button" onClick={onSelect} aria-expanded={active} className="w-full px-3 pb-2 pt-2.5 text-left">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-semibold">Вариант {i + 1}</span>
          <Chip tone="route">
            {path.steps.length} {pluralRu(path.steps.length, "шаг", "шага", "шагов")}
          </Chip>
          {a.kind === "strict" ? <Chip tone="accent">строгий</Chip> : <Chip tone="warn">топологический</Chip>}
          {a.incomplete && <Chip tone="warn">неполные сведения</Chip>}
          {a.compartmentTransitions > 0 && (
            <Chip>
              {a.compartmentTransitions} {pluralRu(a.compartmentTransitions, "переход", "перехода", "переходов")} компартмента
            </Chip>
          )}
        </div>
        {!active && <div className="mt-1 line-clamp-2 text-[12px] text-muted">{preview}</div>}
      </button>
      {active && (
        <div className="px-3 pb-3">
          <div className="mb-2 rounded-lg bg-hover p-2.5 text-[11px] leading-snug text-ink-2">
            <div className="flex items-center gap-1 font-semibold text-muted">
              <Info className="h-3 w-3" /> Почему этот вариант
            </div>
            <p className="mt-1">
              {best ? "Наименьшая суммарная стоимость" : "Следующий по стоимости вариант"}: {path.cost} (шагов {path.steps.length}
              {penalties > 0 ? `, надбавки ${penalties} — за суммарные события, косубстраты, реакции без катализатора или сомнительные сопоставления` : ""}). Варианты не повторяют вершины, поэтому циклы не порождают бесконечных маршрутов.
            </p>
            {a.reasons.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                {a.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>

          <ol className="space-y-1">
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
                  <div className="my-0.5 ml-1 border-l-2 border-route/40 py-1 pl-2.5">
                    <button
                      type="button"
                      onClick={() => nav.open({ type: "reaction", id: s.reactionId })}
                      className="group flex w-full items-start gap-1.5 text-left"
                    >
                      <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0 text-route" />
                      <span className="min-w-0 text-ink-2 group-hover:text-accent">
                        {state.quizMode ? (r?.ecNumbers[0] ? `EC ${r.ecNumbers[0]}` : "реакция") : ((state.preferRu && r?.nameRu) || r?.name)}
                        {s.direction === "backward" && <span className="ml-1 text-warn">(в обратном направлении)</span>}
                      </span>
                    </button>
                    {s.coSubstrates.length > 0 && (
                      <div className="ml-4 text-muted">
                        + {s.coSubstrates.map((p) => `${p.stoichiometry !== 1 ? `${p.stoichiometry} ` : ""}${name(p.metaboliteId)}`).join(", ")}
                      </div>
                    )}
                    {s.coProducts.length > 0 && <div className="ml-4 text-faint">также образуется: {s.coProducts.map((p) => name(p.metaboliteId)).join(", ")}</div>}
                    {s.flags.length > 0 && (
                      <div className="ml-4 mt-1 flex flex-wrap gap-1">
                        {s.flags.map((f) => (
                          <Chip key={f} tone={FLAG_LABEL[f].tone} title={FLAG_LABEL[f].hint}>
                            {FLAG_LABEL[f].text}
                          </Chip>
                        ))}
                      </div>
                    )}
                    {s.alternativeReactionIds.length > 0 && (
                      <div className="ml-4 mt-1 text-[11px] text-muted">
                        Альтернативные реакции этого шага:{" "}
                        {s.alternativeReactionIds.map((alt, ai) => (
                          <span key={alt}>
                            {ai > 0 && ", "}
                            <button type="button" onClick={() => nav.open({ type: "reaction", id: alt })} className="text-accent hover:underline">
                              {state.quizMode ? `вариант ${ai + 1}` : ((state.preferRu && index.reactions.get(alt)?.nameRu) || index.reactions.get(alt)?.name || alt)}
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 font-medium text-ink">
                    <ArrowRight className="h-3 w-3 text-route" />
                    <span className="h-2 w-2 rounded-full" style={{ background: compartmentColor(index.metabolites.get(s.toId)?.compartmentId) }} />
                    {name(s.toId)}
                  </div>
                </li>
              );
            })}
          </ol>

          <CarrierSummary path={path} />
        </div>
      )}
    </li>
  );
}

function CarrierSummary({ path }: { path: RoutePath }) {
  const { consumed, produced, branching } = path.carriers;
  // protons and water are bookkeeping species, not energy carriers
  const skip = new Set(["H+", "H2O"]);
  const fmt = (list: typeof consumed) =>
    list
      .filter((c) => !skip.has(c.label))
      .map((c) => `${c.amount} ${c.label}`)
      .join(", ") || "—";
  return (
    <div className="mt-3 rounded-lg border border-line p-2.5 text-[11px] leading-snug">
      <div className="font-semibold text-muted">Переносчики по реакциям маршрута (вычислено)</div>
      <div className="mt-1 grid grid-cols-[84px_1fr] gap-x-2 gap-y-0.5 text-ink-2">
        <span className="text-muted">Расходуется</span>
        <span className="tabular">{fmt(consumed)}</span>
        <span className="text-muted">Образуется</span>
        <span className="tabular">{fmt(produced)}</span>
      </div>
      <p className="mt-1.5 text-faint">
        Каждая реакция учтена один раз в выбранном направлении; затраты и выход не сальдируются. Это не энергетический выход пути: окислительное
        фосфорилирование и альтернативные кофакторы изоферментов не учитываются.
        {branching && " Часть шагов даёт несколько основных продуктов (например, две триозы), поэтому стехиометрия на молекулу исходного вещества не пересчитана."}
      </p>
    </div>
  );
}
