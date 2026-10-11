"use client";

import { useEffect, useState } from "react";
import type { Dataset } from "@/lib/model/types";
import { checkIntegrity, datasetSchema } from "@/lib/model/schema";
import { mockDataset } from "@/lib/data/mock-dataset";
import { MetaboMapApp } from "./MetaboMapApp";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; dataset: Dataset; warning?: string };

async function loadDataset(): Promise<{ dataset: Dataset; warning?: string }> {
  try {
    const res = await fetch("/data/dataset.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    const parsed = datasetSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`данные не прошли проверку схемы (${issue?.path.join(".")}: ${issue?.message})`);
    }
    const issues = checkIntegrity(parsed.data);
    if (issues.length) console.warn(`Dataset integrity: ${issues.length} issues`, issues.slice(0, 20));
    return { dataset: parsed.data };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      dataset: mockDataset,
      warning: `Не удалось загрузить базу (${reason}). Показан демонстрационный набор.`,
    };
  }
}

export function AppLoader() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    loadDataset().then((r) => alive && setState({ status: "ready", ...r }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="grid h-dvh place-items-center bg-bg">
        <div className="flex flex-col items-center gap-3 text-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          <span className="text-[13px]">Загрузка базы реакций…</span>
        </div>
      </div>
    );
  }
  return <MetaboMapApp dataset={state.dataset} warning={state.warning} />;
}
