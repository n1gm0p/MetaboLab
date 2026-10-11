import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/data/metabo-index";
import { mockDataset } from "@/lib/data/mock-dataset";
import { buildSearchIndex, normalize, search } from "@/lib/search/search";

const index = buildIndex(mockDataset);
const si = buildSearchIndex(index);
const top = (q: string) => search(si, index, q)[0];

describe("unified search", () => {
  it("finds metabolites by Russian name, preferring whole-word matches", () => {
    expect(top("глюкоза")).toMatchObject({ type: "metabolite", id: "glc_c" });
  });

  it("finds by abbreviation, synonym and ChEBI id", () => {
    expect(top("G6P")).toMatchObject({ type: "metabolite", id: "g6p_c" });
    expect(top("dextrose")).toMatchObject({ type: "metabolite", id: "glc_c" });
    expect(top("CHEBI:32816")).toMatchObject({ type: "metabolite", id: "pyr_c" });
  });

  it("distinguishes enzymes, pathways and EC numbers", () => {
    expect(top("гексокиназа")).toMatchObject({ type: "enzyme", id: "enz_hk" });
    expect(top("EC 2.7.1.40")).toMatchObject({ type: "enzyme", id: "enz_pk" });
    expect(top("гликолиз")).toMatchObject({ type: "pathway" });
    expect(top("PKM")).toMatchObject({ type: "enzyme", id: "enz_pk" });
  });

  it("normalizes ё, Greek letters and dashes", () => {
    expect(normalize("α–Кетоглутарат")).toBe("alpha-кетоглутарат");
    expect(normalize("Ёж")).toBe("еж");
  });

  it("returns nothing for an empty query", () => {
    expect(search(si, index, "  ")).toEqual([]);
  });
});
