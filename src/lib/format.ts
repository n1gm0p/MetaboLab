import type { MetaboIndex } from "@/lib/data/metabo-index";
import type { Participant, Reaction } from "@/lib/model/types";

export function participantLabel(index: MetaboIndex, p: Participant, preferRu = true): string {
  const m = index.metabolites.get(p.metaboliteId);
  const name = m ? (preferRu && m.nameRu) || m.name : p.metaboliteId;
  return p.stoichiometry === 1 ? name : `${p.stoichiometry} ${name}`;
}

export function equation(index: MetaboIndex, r: Reaction, preferRu = true): string {
  const side = (ps: Participant[]) => ps.map((p) => participantLabel(index, p, preferRu)).join(" + ");
  return `${side(r.inputs)} ${r.reversible ? "⇄" : "→"} ${side(r.outputs)}`;
}

export const chebiUrl = (chebiId: string) => `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=${chebiId}`;
export const reactomeUrl = (stId: string) => `https://reactome.org/content/detail/${stId}`;
export const rheaUrl = (id: string) => `https://www.rhea-db.org/rhea/${id}`;
export const keggCompoundUrl = (id: string) => `https://www.kegg.jp/entry/${id}`;
export const ecUrl = (ec: string) => `https://enzyme.expasy.org/EC/${ec}`;
export const pubmedUrl = (id: string) => `https://pubmed.ncbi.nlm.nih.gov/${id}/`;

/** Render a chemical formula with subscripts for digits (C6H12O6 -> C₆H₁₂O₆). */
export function prettyFormula(f: string): string {
  const sub = "₀₁₂₃₄₅₆₇₈₉";
  return f.replace(/(?<=[A-Za-z)\]])(\d+)/g, (d) => [...d].map((c) => sub[Number(c)]).join(""));
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
