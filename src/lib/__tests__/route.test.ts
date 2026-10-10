import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/data/metabo-index";
import { findRoutes } from "@/lib/graph/route";
import { mockDataset } from "@/lib/data/mock-dataset";
import { CYTOSOL, MATRIX, dataset, met, rxn } from "./fixtures";

const strict = { mode: "strict" as const, k: 5, maxSteps: 20 };

describe("route search", () => {
  it("finds the glycolytic sequence glucose -> pyruvate in the mock data", () => {
    const index = buildIndex(mockDataset);
    const res = findRoutes(index, ["glc_c"], ["pyr_c"], strict);
    expect(res.paths.length).toBeGreaterThan(0);
    const best = res.paths[0]!;
    expect(best.metaboliteIds[0]).toBe("glc_c");
    expect(best.metaboliteIds.at(-1)).toBe("pyr_c");
    // HK, GPI, PFK, aldolase (-> GA3P), GAPDH, PGK, PGAM, enolase, PK
    expect(best.steps).toHaveLength(9);
    expect(best.metaboliteIds).not.toContain("atp_c");
  });

  it("respects reaction direction", () => {
    const ds = dataset([met("A"), met("B"), met("C")], [rxn("R1", [["A"]], [["B"]]), rxn("R2", [["B"]], [["C"]])]);
    const index = buildIndex(ds);
    expect(findRoutes(index, ["A"], ["C"], strict).paths).toHaveLength(1);
    expect(findRoutes(index, ["C"], ["A"], strict).paths).toHaveLength(0);
    // relaxed (topological) mode ignores direction
    expect(findRoutes(index, ["C"], ["A"], { ...strict, mode: "relaxed" }).paths).toHaveLength(1);
  });

  it("allows backward traversal only for reversible reactions", () => {
    const ds = dataset([met("A"), met("B")], [rxn("R1", [["A"]], [["B"]], { reversible: true })]);
    const res = findRoutes(buildIndex(ds), ["B"], ["A"], strict);
    expect(res.paths).toHaveLength(1);
    expect(res.paths[0]!.steps[0]!.direction).toBe("backward");
  });

  it("requires a transport reaction between compartments in strict mode", () => {
    const mets = [
      met("pyr_c", { chebiId: "CHEBI:1" }),
      met("pyr_m", { chebiId: "CHEBI:1", compartmentId: MATRIX }),
      met("accoa_m", { compartmentId: MATRIX }),
    ];
    const pdh = rxn("PDH", [["pyr_m"]], [["accoa_m"]], { compartmentIds: [MATRIX] });
    const noTransport = buildIndex(dataset(mets, [pdh]));
    expect(findRoutes(noTransport, ["pyr_c"], ["accoa_m"], strict).paths).toHaveLength(0);

    const relaxed = findRoutes(noTransport, ["pyr_c"], ["accoa_m"], { ...strict, mode: "relaxed" });
    expect(relaxed.paths).toHaveLength(1);

    const transport = rxn("MPC", [["pyr_c"]], [["pyr_m"]], { compartmentIds: [CYTOSOL, MATRIX], isTransport: true });
    const withTransport = buildIndex(dataset(mets, [pdh, transport]));
    const res = findRoutes(withTransport, ["pyr_c"], ["accoa_m"], strict);
    expect(res.paths[0]!.steps.map((s) => s.reactionId)).toEqual(["MPC", "PDH"]);
  });

  it("reports co-substrates of multi-substrate reactions", () => {
    const ds = dataset(
      [met("A"), met("B"), met("C"), met("H2O", { currency: true })],
      [rxn("R1", [["A"], ["B"], ["H2O"]], [["C"]])],
    );
    const step = findRoutes(buildIndex(ds), ["A"], ["C"], strict).paths[0]!.steps[0]!;
    expect(step.coSubstrates.map((p) => p.metaboliteId)).toEqual(["B"]);
  });

  it("returns a bounded number of loop-free routes around cycles", () => {
    // cycle A->B->C->A, exit C->D, shortcut A->C
    const ds = dataset(
      [met("A"), met("B"), met("C"), met("D")],
      [
        rxn("AB", [["A"]], [["B"]]),
        rxn("BC", [["B"]], [["C"]]),
        rxn("CA", [["C"]], [["A"]]),
        rxn("CD", [["C"]], [["D"]]),
        rxn("AC", [["A"]], [["C"]]),
      ],
    );
    const res = findRoutes(buildIndex(ds), ["A"], ["D"], { ...strict, k: 10 });
    expect(res.paths).toHaveLength(2);
    for (const p of res.paths) expect(new Set(p.metaboliteIds).size).toBe(p.metaboliteIds.length);
    expect(res.paths[0]!.steps.length).toBeLessThanOrEqual(res.paths[1]!.steps.length);
  });

  it("supports several start compartments (multi-source)", () => {
    const mets = [met("A_c", { chebiId: "CHEBI:9" }), met("A_m", { chebiId: "CHEBI:9", compartmentId: MATRIX }), met("B")];
    const ds = dataset(mets, [rxn("R", [["A_m"]], [["B"]])]);
    const res = findRoutes(buildIndex(ds), ["A_c", "A_m"], ["B"], strict);
    expect(res.paths[0]!.metaboliteIds).toEqual(["A_m", "B"]);
  });
});
