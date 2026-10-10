import type { MetaboIndex } from "@/lib/data/metabo-index";
import type { EntityType } from "@/lib/model/types";

export interface SearchResult {
  type: EntityType;
  id: string;
  title: string;
  subtitle?: string;
  /** which field matched, e.g. a synonym */
  matched?: string;
  score: number;
  /** compartment-specific variants of the same chemical (metabolites only) */
  variantIds?: string[];
}

interface Entry {
  type: EntityType;
  id: string;
  title: string;
  subtitle?: string;
  terms: { norm: string; raw: string; weight: number }[];
  groupKey?: string;
}

export interface SearchIndex {
  entries: Entry[];
}

/** Lower-case, unify Greek letters / dashes / ё, strip punctuation spacing. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/γ/g, "gamma")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[\s_]+/g, " ")
    .replace(/[()[\]{},;:]/g, "")
    .trim();
}

/** "1,3-bisphosphoglycerate" also matches "13bpg"-style compact queries. */
const compact = (s: string) => s.replace(/[^a-zа-я0-9+]/g, "");

export function buildSearchIndex(index: MetaboIndex): SearchIndex {
  const entries: Entry[] = [];
  const term = (raw: string | undefined, weight: number) =>
    raw ? [{ raw, norm: normalize(raw), weight }] : [];

  // Metabolites: one entry per chemical (chebi), listing compartment variants.
  const groups = new Map<string, string[]>();
  for (const m of index.dataset.metabolites) {
    const key = m.chebiId ?? `id:${m.id}`;
    const g = groups.get(key);
    if (g) g.push(m.id);
    else groups.set(key, [m.id]);
  }
  for (const [key, ids] of groups) {
    const ms = ids.map((id) => index.metabolites.get(id)!).filter(Boolean);
    const m = ms[0];
    if (!m) continue;
    const synonyms = new Set(ms.flatMap((x) => [x.name, ...x.synonyms]));
    entries.push({
      type: "metabolite",
      id: m.id,
      groupKey: key,
      title: m.nameRu ?? m.name,
      subtitle: [m.nameRu ? m.name : undefined, m.formula, m.chebiId].filter(Boolean).join(" · "),
      terms: [
        ...term(m.nameRu, 1.0),
        ...term(m.name, 1.0),
        ...term(m.abbreviation, 0.95),
        ...term(m.chebiId, 0.9),
        ...term(m.formula, 0.6),
        ...[...synonyms].flatMap((s) => term(s, 0.85)),
      ],
    });
  }

  for (const r of index.dataset.reactions) {
    entries.push({
      type: "reaction",
      id: r.id,
      title: r.nameRu ?? r.name,
      subtitle: [r.ecNumbers.length ? `EC ${r.ecNumbers.join(", ")}` : undefined, r.id].filter(Boolean).join(" · "),
      terms: [...term(r.nameRu, 0.8), ...term(r.name, 0.8), ...term(r.id, 0.9), ...r.rheaIds.flatMap((x) => term(`RHEA:${x}`, 0.9))],
    });
  }

  for (const e of index.dataset.enzymes) {
    entries.push({
      type: "enzyme",
      id: e.id,
      title: e.nameRu ?? e.name,
      subtitle: [e.genes.slice(0, 6).join(", "), e.ecNumbers.map((x) => `EC ${x}`).join(", ")].filter(Boolean).join(" · "),
      terms: [
        ...term(e.nameRu, 1.0),
        ...term(e.name, 1.0),
        ...term(e.activity, 0.8),
        ...e.genes.flatMap((g) => term(g, 0.95)),
        ...e.synonyms.flatMap((s) => term(s, 0.85)),
        ...e.ecNumbers.flatMap((x) => [...term(x, 0.95), ...term(`EC ${x}`, 0.95)]),
      ],
    });
  }

  for (const p of index.dataset.pathways) {
    entries.push({
      type: "pathway",
      id: p.id,
      title: p.nameRu ?? p.name,
      subtitle: p.nameRu ? p.name : p.id,
      terms: [...term(p.nameRu, 1.05), ...term(p.name, 1.05), ...term(p.id, 0.9)],
    });
  }
  return { entries };
}

function scoreTerm(q: string, qc: string, t: string): number {
  if (t === q) return 100;
  if (t.startsWith(q)) return 80 - Math.min(20, t.length - q.length) * 0.5;
  // word-start match ("6-phosphate" inside "glucose 6-phosphate")
  const wordIdx = t.search(new RegExp(`(^|[\\s\\-,/])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (wordIdx >= 0) return 60 - Math.min(20, wordIdx) * 0.3;
  if (t.includes(q)) return 40;
  if (qc.length >= 3 && compact(t).includes(qc)) return 30;
  return 0;
}

export function search(
  si: SearchIndex,
  index: MetaboIndex,
  query: string,
  opts: { limit?: number; types?: EntityType[] } = {},
): SearchResult[] {
  const q = normalize(query);
  if (!q) return [];
  const qc = compact(q);
  const limit = opts.limit ?? 30;
  const results: SearchResult[] = [];
  for (const e of si.entries) {
    if (opts.types && !opts.types.includes(e.type)) continue;
    let best = 0;
    let matched: string | undefined;
    for (const t of e.terms) {
      const s = scoreTerm(q, qc, t.norm) * t.weight;
      if (s > best) {
        best = s;
        matched = t.raw;
      }
    }
    if (best <= 0) continue;
    // Prefer small molecules and named things over long reaction titles
    const typeBoost = e.type === "metabolite" ? 4 : e.type === "pathway" ? 3 : e.type === "enzyme" ? 2 : 0;
    results.push({
      type: e.type,
      id: e.id,
      title: e.title,
      subtitle: e.subtitle,
      matched: matched && normalize(matched) !== normalize(e.title) ? matched : undefined,
      score: best + typeBoost,
      variantIds: e.type === "metabolite" && e.groupKey ? index.byChebi.get(e.groupKey.replace(/^id:/, "")) : undefined,
    });
  }
  results.sort((a, b) => b.score - a.score || a.title.length - b.title.length);
  return results.slice(0, limit);
}
