/**
 * Scenario checks of key pathways against the generated Reactome dataset.
 * Expectations are textbook facts that the SOURCE data must reproduce; nothing is added manually.
 * Skipped when public/data/dataset.json has not been generated.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex, type MetaboIndex } from "@/lib/data/metabo-index";
import { findRoutes, type RoutePath } from "@/lib/graph/route";
import { auditDataset } from "@/lib/audit/audit";
import type { Dataset } from "@/lib/model/types";

const FILE = new URL("../../../public/data/dataset.json", import.meta.url);
const has = existsSync(FILE);
const CYTOSOL = "GO:0005829";
const MATRIX = "GO:0005759";

describe.skipIf(!has)("key pathway scenarios (Reactome data)", () => {
  const ds: Dataset = has ? JSON.parse(readFileSync(FILE, "utf8")) : (null as never);
  const index: MetaboIndex = has ? buildIndex(ds) : (null as never);
  const at = (chebi: string, comp: string) =>
    (index.byChebi.get(chebi) ?? []).filter((id) => index.metabolites.get(id)?.compartmentId === comp);
  const chebiSeq = (p: RoutePath) => p.metaboliteIds.map((id) => index.metabolites.get(id)?.chebiId ?? `(${index.metabolites.get(id)?.kind})`);
  const ecs = (p: RoutePath) => p.steps.map((s) => index.reactions.get(s.reactionId)!.ecNumbers);
  const inPathway = (id: string) => new Set(index.pathwayReactionsDeep.get(id) ?? []);
  const amount = (list: { label: string; amount: number }[], label: string) => list.find((c) => c.label === label)?.amount ?? 0;
  const route = (from: string[], to: string[], pathway?: string, k = 3) =>
    findRoutes(index, from, to, { mode: "strict", k, maxSteps: 25, allowedReactionIds: pathway ? inPathway(pathway) : undefined });

  it("glycolysis: glucose -> pyruvate in the cytosol, ten classical intermediates", () => {
    const res = route(at("CHEBI:4167", CYTOSOL), at("CHEBI:15361", CYTOSOL), "R-HSA-70171");
    const best = res.paths[0]!;
    expect(chebiSeq(best)).toEqual([
      "CHEBI:4167", // glucose
      "CHEBI:58225", // G6P
      "CHEBI:57634", // F6P
      "CHEBI:32966", // F1,6BP
      "CHEBI:59776", // GA3P
      "CHEBI:57604", // 1,3-BPG
      "CHEBI:58272", // 3PG
      "CHEBI:58289", // 2PG
      "CHEBI:58702", // PEP
      "CHEBI:15361", // pyruvate
    ]);
    expect(best.metaboliteIds.every((id) => index.metabolites.get(id)?.compartmentId === CYTOSOL)).toBe(true);
    const e = ecs(best);
    for (const [i, ec] of [[1, "5.3.1.9"], [2, "2.7.1.11"], [3, "4.1.2.13"], [4, "1.2.1.12"], [5, "2.7.2.3"], [6, "5.4.2.11"], [7, "4.2.1.11"], [8, "2.7.1.40"]] as const)
      expect(e[i]).toContain(ec);
    // hexokinase step: both the ATP-dependent hexokinases and ADP-dependent glucokinase are offered
    const step0 = [best.steps[0]!.reactionId, ...best.steps[0]!.alternativeReactionIds];
    expect(step0).toContain("R-HSA-70420");
    expect(best.assessment.incomplete).toBe(false);
    // one pass through the reactions: GAPDH yields 1 NADH, PGK + PK yield 2 ATP per triose
    expect(amount(best.carriers.produced, "NADH")).toBe(1);
    expect(amount(best.carriers.produced, "ATP")).toBe(2);
    expect(best.carriers.branching).toBe(true); // aldolase gives two trioses: not scaled
  });

  it("direction is respected: no route back from pyruvate to glucose through glycolytic reactions", () => {
    expect(route(at("CHEBI:15361", CYTOSOL), at("CHEBI:4167", CYTOSOL), "R-HSA-70171").paths).toHaveLength(0);
  });

  it("gluconeogenesis: mitochondrial pyruvate -> cytosolic PEP needs PC, transport and PEPCK", () => {
    const best = route(at("CHEBI:15361", MATRIX), at("CHEBI:58702", CYTOSOL)).paths[0]!;
    const all = ecs(best).flat();
    expect(all).toContain("6.4.1.1");
    expect(all).toContain("4.1.1.32");
    expect(best.assessment.compartmentTransitions).toBeGreaterThan(0);
  });

  it("TCA cycle: citrate -> oxaloacetate in the matrix", () => {
    const best = route(at("CHEBI:16947", MATRIX), at("CHEBI:16452", MATRIX), "R-HSA-71403").paths[0]!;
    const seq = chebiSeq(best).filter((c) => c.startsWith("CHEBI"));
    expect(seq).toEqual([
      "CHEBI:16947", // citrate
      "CHEBI:15562", // isocitrate
      "CHEBI:16810", // 2-oxoglutarate
      "CHEBI:57292", // succinyl-CoA
      "CHEBI:30031", // succinate
      "CHEBI:29806", // fumarate
      "CHEBI:15589", // malate
      "CHEBI:16452", // oxaloacetate
    ]);
    expect(best.metaboliteIds.every((id) => index.metabolites.get(id)?.compartmentId === MATRIX)).toBe(true);
    expect(amount(best.carriers.produced, "CO2")).toBe(2);
    // IDH: NAD+- and NADP+-dependent isoforms are both available as alternatives
    expect(best.steps.some((s) => s.alternativeReactionIds.length > 0)).toBe(true);
  });

  it("pentose phosphate pathway, oxidative phase: 2 NADPH and 1 CO2 per G6P", () => {
    const best = route(at("CHEBI:58225", CYTOSOL), at("CHEBI:58121", CYTOSOL), "R-HSA-71336").paths[0]!;
    expect(chebiSeq(best)).toEqual(["CHEBI:58225", "CHEBI:57955", "CHEBI:58759", "CHEBI:58121"]);
    expect(amount(best.carriers.produced, "NADPH")).toBe(2);
    expect(amount(best.carriers.produced, "CO2")).toBe(1);
    expect(best.carriers.branching).toBe(false);
  });

  it("mitochondrial beta-oxidation: palmitoyl-CoA -> acetyl-CoA gives 1 FADH2 and 1 NADH per round", () => {
    const best = route(at("CHEBI:57379", MATRIX), at("CHEBI:57288", MATRIX), "R-HSA-77289").paths[0]!;
    expect(best.steps).toHaveLength(4);
    expect(amount(best.carriers.produced, "FADH2")).toBe(1);
    expect(amount(best.carriers.produced, "NADH")).toBe(1);
  });

  it("urea cycle: ornithine (matrix) -> urea (cytosol) via citrulline export", () => {
    const best = route(at("CHEBI:46911", MATRIX), at("CHEBI:16199", CYTOSOL), "R-HSA-70635").paths[0]!;
    expect(chebiSeq(best)).toEqual(["CHEBI:46911", "CHEBI:57743", "CHEBI:57743", "CHEBI:57472", "CHEBI:32682", "CHEBI:16199"]);
    expect(best.assessment.compartmentTransitions).toBe(1);
    expect(ecs(best).flat()).toEqual(expect.arrayContaining(["2.1.3.3", "6.3.4.5", "4.3.2.1", "3.5.3.1"]));
  });

  it("amino acid metabolism: alanine -> pyruvate is a transamination with 2-oxoglutarate", () => {
    const best = route(at("CHEBI:57972", CYTOSOL), at("CHEBI:15361", CYTOSOL)).paths[0]!;
    expect(best.steps).toHaveLength(1);
    expect(index.reactions.get(best.steps[0]!.reactionId)!.ecNumbers).toContain("2.6.1.2");
    expect(best.steps[0]!.coSubstrates.map((p) => index.metabolites.get(p.metaboliteId)?.chebiId)).toEqual(["CHEBI:16810"]);
  });

  it("glycolysis -> TCA link: cytosolic pyruvate reaches matrix acetyl-CoA via transport and PDH", () => {
    const best = route(at("CHEBI:15361", CYTOSOL), at("CHEBI:57288", MATRIX)).paths[0]!;
    expect(best.steps.filter((s) => s.flags.includes("transport")).length).toBeGreaterThan(0);
    expect(ecs(best).flat()).toContain("1.2.4.1");
  });

  it("TCA -> respiratory chain: complex I oxidises matrix NADH and reduces ubiquinone", () => {
    const nadhMatrix = new Set(at("CHEBI:57945", MATRIX));
    const etc = inPathway("R-HSA-611105");
    const complexI = [...etc]
      .map((id) => index.reactions.get(id)!)
      .find((r) => r.inputs.some((p) => nadhMatrix.has(p.metaboliteId)) && r.outputs.some((p) => index.metabolites.get(p.metaboliteId)?.chebiId === "CHEBI:64183"));
    expect(complexI).toBeDefined();
  });

  it("reverse links are symmetric and the audit finds no errors", () => {
    for (const r of ds.reactions)
      if (r.reverseReactionId) expect(index.reactions.get(r.reverseReactionId)?.reverseReactionId, r.id).toBe(r.id);
    expect(auditDataset(ds).categories.filter((c) => c.severity === "error")).toEqual([]);
  });
});
