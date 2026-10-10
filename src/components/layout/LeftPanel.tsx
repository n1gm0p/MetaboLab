"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { BookMarked, GitFork, Waypoints } from "lucide-react";
import { useApp, type LeftTab } from "@/components/state/app-state";
import { cx } from "@/components/ui/primitives";
import { PathwayTree } from "./PathwayTree";
import { AboutDataDialog } from "./AboutDataDialog";
import { RoutePanel } from "@/components/route/RoutePanel";
import { LibraryPanel } from "@/components/library/LibraryPanel";

const TABS: { key: LeftTab; label: string; icon: React.ReactNode }[] = [
  { key: "pathways", label: "Пути", icon: <GitFork className="h-3.5 w-3.5" /> },
  { key: "route", label: "Маршрут", icon: <Waypoints className="h-3.5 w-3.5" /> },
  { key: "library", label: "Моё", icon: <BookMarked className="h-3.5 w-3.5" /> },
];

export function LeftPanel() {
  const { state, dispatch, index } = useApp();
  const meta = index.dataset.meta;
  return (
    <Tabs.Root
      value={state.leftTab}
      onValueChange={(v) => dispatch({ type: "setLeftTab", tab: v as LeftTab })}
      className="flex h-full min-h-0 flex-col"
    >
      <Tabs.List className="m-3 grid grid-cols-3 gap-1 rounded-xl bg-hover p-1" aria-label="Разделы">
        {TABS.map((t) => (
          <Tabs.Trigger
            key={t.key}
            value={t.key}
            className={cx(
              "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium text-muted transition-colors",
              "data-[state=active]:bg-panel-solid data-[state=active]:text-ink data-[state=active]:shadow-sm",
            )}
          >
            {t.icon}
            {t.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="pathways" className="flex min-h-0 flex-1 flex-col outline-none">
        <PathwayTree />
      </Tabs.Content>
      <Tabs.Content value="route" className="flex min-h-0 flex-1 flex-col outline-none">
        <RoutePanel />
      </Tabs.Content>
      <Tabs.Content value="library" className="flex min-h-0 flex-1 flex-col outline-none">
        <LibraryPanel />
      </Tabs.Content>
      <div className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-muted">
        {meta.isMock ? (
          <span className="text-warn">Демонстрационный набор (10 реакций). </span>
        ) : (
          <span>
            {meta.sources.map((s) => `${s.name}${s.version ? ` v${s.version}` : ""}`).join(" · ")}.{" "}
          </span>
        )}
        <AboutDataDialog />
      </div>
    </Tabs.Root>
  );
}
