"use client";

import type { EntityRef } from "@/lib/model/types";

export function CardActions({ refTo, children }: { refTo: EntityRef; children?: React.ReactNode }) {
  void refTo;
  return <div className="flex flex-wrap items-center gap-1.5 px-5 pb-4">{children}</div>;
}
