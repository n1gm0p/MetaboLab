"use client";

import { mockDataset } from "@/lib/data/mock-dataset";
import { MetaboMapApp } from "./MetaboMapApp";

export function AppLoader() {
  return <MetaboMapApp dataset={mockDataset} />;
}
