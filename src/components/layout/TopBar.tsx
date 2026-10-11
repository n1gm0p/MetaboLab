"use client";

import * as Popover from "@radix-ui/react-popover";
import { GraduationCap, PanelLeft, PanelRight, SlidersHorizontal, Waypoints } from "lucide-react";
import type { CofactorMode } from "@/lib/graph/build";
import { useApp } from "@/components/state/app-state";
import { useNavigator } from "@/components/state/use-navigator";
import { SearchBox } from "@/components/search/SearchBox";
import { IconButton, cx } from "@/components/ui/primitives";

export function TopBar() {
  const { state, dispatch } = useApp();
  const nav = useNavigator();

  return (
    <header className="glass relative z-30 flex h-14 shrink-0 items-center gap-2 rounded-none border-x-0 border-t-0 px-2 pt-[env(safe-area-inset-top)] sm:px-3">
      <IconButton label={state.leftOpen ? "Скрыть навигацию" : "Показать навигацию"} active={state.leftOpen} onClick={() => dispatch({ type: "setLeftOpen", value: !state.leftOpen })}>
        <PanelLeft className="h-[18px] w-[18px]" />
      </IconButton>
      <div className="mr-1 hidden items-center gap-2 pl-1 md:flex">
        <span className="text-[15px] font-semibold tracking-tight">MetaboMap</span>
      </div>

      <div className="mx-auto min-w-0 w-full max-w-xl">
        <SearchBox onPick={(ref) => nav.open(ref)} globalShortcut showFilters />
      </div>

      <IconButton label="Маршрут между веществами" active={state.leftOpen && state.leftTab === "route"} onClick={() => dispatch({ type: "setLeftTab", tab: "route" })}>
        <Waypoints className="h-[18px] w-[18px]" />
      </IconButton>
      <IconButton
        label={state.quizMode ? "Выключить самопроверку" : "Режим самопроверки"}
        active={state.quizMode}
        className="max-sm:hidden"
        onClick={() => dispatch({ type: "setQuiz", value: !state.quizMode })}
      >
        <GraduationCap className="h-[18px] w-[18px]" />
      </IconButton>
      <SettingsPopover />
      <IconButton
        label={state.rightOpen ? "Скрыть карточку" : "Показать карточку"}
        active={state.rightOpen}
        disabled={!state.focus}
        className="max-sm:hidden"
        onClick={() => dispatch({ type: "setRightOpen", value: !state.rightOpen })}
      >
        <PanelRight className="h-[18px] w-[18px]" />
      </IconButton>
    </header>
  );
}

function SettingsPopover() {
  const { state, dispatch } = useApp();
  const modes: { key: CofactorMode; label: string; hint: string }[] = [
    { key: "duplicate", label: "Дублировать", hint: "отдельная копия у каждой реакции — карта читается легче" },
    { key: "shared", label: "Общий узел", hint: "один узел ATP/NAD⁺ на всю карту" },
    { key: "hide", label: "Скрыть", hint: "только основные субстраты и продукты" },
  ];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton label="Фильтры и отображение">
          <SlidersHorizontal className="h-[18px] w-[18px]" />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="glass z-50 w-80 rounded-2xl p-4 text-[13px] animate-in">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Кофакторы (ATP, NAD⁺, H₂O…)</div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-hover p-1">
            {modes.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => dispatch({ type: "setCofactorMode", mode: m.key })}
                className={cx(
                  "min-h-8 rounded-lg text-[12px] font-medium",
                  state.cofactorMode === m.key ? "bg-panel-solid text-ink shadow-sm" : "text-muted",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-muted">{modes.find((m) => m.key === state.cofactorMode)?.hint}</p>

          <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Названия</div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-hover p-1">
            {[
              { v: true, l: "Русские" },
              { v: false, l: "Международные" },
            ].map((o) => (
              <button
                key={o.l}
                type="button"
                onClick={() => dispatch({ type: "setPreferRu", value: o.v })}
                className={cx("min-h-8 rounded-lg text-[12px] font-medium", state.preferRu === o.v ? "bg-panel-solid text-ink shadow-sm" : "text-muted")}
              >
                {o.l}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-muted">Русское название показывается, только если оно есть в курируемом словаре.</p>

          <label className="mt-4 flex min-h-10 cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="font-medium">Самопроверка</span>
              <span className="block text-[12px] text-muted">скрыть названия веществ и ферментов</span>
            </span>
            <input type="checkbox" aria-label="Самопроверка" className="h-5 w-5 accent-[var(--accent)]" checked={state.quizMode} onChange={(e) => dispatch({ type: "setQuiz", value: e.target.checked })} />
          </label>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
