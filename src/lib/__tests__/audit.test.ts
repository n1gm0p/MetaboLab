import { describe, expect, it } from "vitest";
import { auditDataset, compartmentMismatch, elementBalance, parseFormula } from "@/lib/audit/audit";
import { mockDataset } from "@/lib/data/mock-dataset";
import { MATRIX, dataset, met, rxn } from "./fixtures";

const byId = (ds: ReturnType<typeof dataset>) => new Map(ds.metabolites.map((m) => [m.id, m]));
const category = (report: ReturnType<typeof auditDataset>, id: string) => report.categories.find((c) => c.id === id);

describe("data audit", () => {
  it("parses Hill formulas and refuses generic ones", () => {
    expect(parseFormula("C6H12O6")).toEqual({ C: 6, H: 12, O: 6 });
    expect(parseFormula("C3H3O3")).toEqual({ C: 3, H: 3, O: 3 });
    expect(parseFormula("C15H29O2R")).toBeNull();
    expect(parseFormula("(C6H10O5)n")).toBeNull();
    expect(parseFormula(undefined)).toBeNull();
  });

  it("checks element balance with stoichiometry and ignores hydrogen", () => {
    const ds = dataset(
      [met("h2o2", { formula: "H2O2" }), met("o2", { formula: "O2" }), met("h2o", { formula: "H2O" })],
      [rxn("CAT", [["h2o2", 2]], [["o2"], ["h2o", 2]]), rxn("BAD", [["h2o2"]], [["o2"], ["h2o", 2]])],
    );
    const m = byId(ds);
    expect(elementBalance(ds.reactions[0]!, m)).toEqual({ status: "balanced" });
    expect(elementBalance(ds.reactions[1]!, m)).toEqual({ status: "unbalanced", difference: { O: -2 } });
  });

  it("does not check balance when formulas are missing or generic", () => {
    const ds = dataset([met("a"), met("b", { formula: "C2R" })], [rxn("R", [["a"]], [["b"]])]);
    expect(elementBalance(ds.reactions[0]!, byId(ds)).status).toBe("not-checkable");
  });

  it("reports participants located outside the reaction compartments", () => {
    const ds = dataset([met("a"), met("b", { compartmentId: MATRIX })], [rxn("T", [["a"]], [["b"]])]);
    expect(compartmentMismatch(ds.reactions[0]!, byId(ds))).toEqual([MATRIX]);
  });

  it("flags asymmetric and non-mirrored reverse links", () => {
    const ds = dataset(
      [met("a"), met("b"), met("c")],
      [
        rxn("F", [["a"]], [["b"]], { reverseReactionId: "B" }),
        rxn("B", [["c"]], [["a"]]),
      ],
    );
    const report = auditDataset(ds);
    expect(category(report, "reverse-asymmetric")?.count).toBe(1);
    expect(category(report, "reverse-not-mirror")?.count).toBe(1);
  });

  it("separates isoenzyme duplicates from suspicious duplicates", () => {
    const ds = dataset(
      [met("a"), met("b")],
      [
        rxn("I1", [["a"]], [["b"]], { enzymeIds: ["e1"] }),
        rxn("I2", [["a"]], [["b"]], { enzymeIds: ["e2"] }),
        rxn("D1", [["b"]], [["a"]], { enzymeIds: ["e1"] }),
        rxn("D2", [["b"]], [["a"]], { enzymeIds: ["e1"] }),
      ],
    );
    ds.enzymes = ["e1", "e2"].map((id) => ({
      id,
      name: id,
      synonyms: [],
      genes: ["G"],
      ecNumbers: [],
      cofactorIds: [],
      reactionIds: [],
      compartmentIds: [],
      sources: [{ db: "curated", id }],
    }));
    const report = auditDataset(ds);
    expect(category(report, "dup-equation-isoenzymes")?.count).toBe(1);
    expect(category(report, "dup-equation-same-catalyst")?.count).toBe(1);
  });

  it("allows the same id in different record types but not within one", () => {
    const ds = dataset([met("X")], [rxn("X", [["X"]], [["X"]])]);
    expect(category(auditDataset(ds), "duplicate-id")).toBeUndefined();
    ds.metabolites.push(met("X"));
    expect(category(auditDataset(ds), "duplicate-id")?.count).toBe(1);
  });

  it("passes the hand-written demo dataset without errors", () => {
    const report = auditDataset(mockDataset);
    expect(report.categories.filter((c) => c.severity === "error")).toEqual([]);
  });
});
