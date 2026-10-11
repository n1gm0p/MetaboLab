import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkIntegrity, datasetSchema, detailShardSchema } from "@/lib/model/schema";
import { buildIndex } from "@/lib/data/metabo-index";
import { findRoutes } from "@/lib/graph/route";
import type { Dataset } from "@/lib/model/types";

const DATASET = new URL("../../../public/data/dataset.json", import.meta.url);
const hasDataset = existsSync(DATASET);

/** Validates the generated dataset (skipped when the importer has not been run). */
describe.skipIf(!hasDataset)("generated dataset (public/data)", () => {
  const raw: unknown = hasDataset ? JSON.parse(readFileSync(DATASET, "utf8")) : null;

  it("matches the Zod schema", () => {
    const res = datasetSchema.safeParse(raw);
    if (!res.success) console.error(res.error.issues.slice(0, 5));
    expect(res.success).toBe(true);
  });

  it("has no dangling references", () => {
    expect(checkIntegrity(raw as Dataset)).toEqual([]);
  });

  it("every record carries a source", () => {
    const ds = raw as Dataset;
    for (const list of [ds.metabolites, ds.reactions, ds.enzymes, ds.pathways])
      for (const x of list) expect(x.sources.length, x.id).toBeGreaterThan(0);
  });

  it("detail shards match their schema", () => {
    const ds = raw as Dataset;
    for (let i = 0; i < ds.meta.detailShards; i++) {
      const shard = JSON.parse(readFileSync(new URL(`../../../public/data/details/${i}.json`, import.meta.url), "utf8"));
      expect(detailShardSchema.safeParse(shard).success, `shard ${i}`).toBe(true);
    }
  });

  it("contains the glycolytic route glucose -> pyruvate in the cytosol", () => {
    const index = buildIndex(raw as Dataset);
    const cyto = (chebi: string) =>
      (index.byChebi.get(chebi) ?? []).filter((id) => index.metabolites.get(id)?.compartmentId === "GO:0005829");
    const glc = cyto("CHEBI:4167");
    const pyr = cyto("CHEBI:15361");
    expect(glc.length).toBeGreaterThan(0);
    expect(pyr.length).toBeGreaterThan(0);
    const res = findRoutes(index, glc, pyr, { mode: "strict", k: 3, maxSteps: 20 });
    expect(res.paths.length).toBeGreaterThan(0);
  });

  it("reaction EC numbers come from that reaction's own catalyst activities (regression)", () => {
    const ds = raw as Dataset;
    for (const r of ds.reactions) {
      const own = [...new Set((r.catalysis ?? []).flatMap((c) => c.ecNumbers))].sort();
      expect([...r.ecNumbers].sort(), r.id).toEqual(own);
    }
    // ALOX12 also has a 5.4.4.7 activity elsewhere; it must not leak into this reaction
    expect(ds.reactions.find((r) => r.id === "R-HSA-2161948")?.ecNumbers).toEqual(["1.13.11.31"]);
  });

  it("translocations are flagged as transport even when the two forms have different ChEBI ids (regression)", () => {
    const ds = raw as Dataset;
    // GSH: cytosolic and extracellular forms are different ChEBI entities in Reactome
    expect(ds.reactions.find((r) => r.id === "R-HSA-1247915")?.isTransport).toBe(true);
    // a chemical conversion inside one compartment is not transport
    expect(ds.reactions.find((r) => r.id === "R-HSA-70471")?.isTransport).toBe(false);
  });
});
