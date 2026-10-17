/**
 * Teaching skeleton: fixed world coordinates for the core metabolites of the main pathways,
 * keyed by ChEBI id so the same compound always lands in the same place regardless of which
 * pathway loaded it onto the map (a "Roche-chart"-like stable geography).
 *
 * Only the teaching backbone is placed by hand; every other node (most reaction nodes and
 * peripheral metabolites) is arranged by the force layout AROUND these fixed anchors.
 *
 * The TCA cycle is generated as a perfect circle so it always reads as a ring.
 * Nothing here is scientific data — it is purely visual placement.
 */

export interface Point {
  x: number;
  y: number;
}

// world units; one metabolite box is ~160×30, so steps of ~230 keep them apart.
const SCALE = 1.5;

/** raw layout before scaling; glycolysis runs down the centre, TCA is a ring below it */
const RAW: Record<string, Point> = {
  // --- glycolysis / gluconeogenesis (shared), top → bottom ---
  "CHEBI:4167": { x: 0, y: 0 }, // D-glucose
  "CHEBI:58225": { x: 0, y: 160 }, // glucose-6-phosphate
  "CHEBI:57634": { x: 0, y: 320 }, // fructose-6-phosphate
  "CHEBI:32966": { x: 0, y: 480 }, // fructose-1,6-bisphosphate
  "CHEBI:59776": { x: -120, y: 620 }, // GA3P
  "CHEBI:57642": { x: 150, y: 620 }, // DHAP
  "CHEBI:57604": { x: -120, y: 760 }, // 1,3-BPG
  "CHEBI:58272": { x: -120, y: 900 }, // 3-PG
  "CHEBI:58289": { x: -120, y: 1040 }, // 2-PG
  "CHEBI:58702": { x: -120, y: 1180 }, // PEP
  "CHEBI:15361": { x: 0, y: 1340 }, // pyruvate (hub)
  "CHEBI:16651": { x: -300, y: 1340 }, // lactate
  "CHEBI:57288": { x: 210, y: 1500 }, // acetyl-CoA (gateway to TCA)

  // --- pentose phosphate, right of G6P/F6P ---
  "CHEBI:57955": { x: 240, y: 160 }, // 6-phosphogluconolactone
  "CHEBI:58759": { x: 400, y: 160 }, // 6-phosphogluconate
  "CHEBI:58121": { x: 400, y: 320 }, // ribulose-5-P
  "CHEBI:78346": { x: 260, y: 460 }, // ribose-5-P
  "CHEBI:57737": { x: 540, y: 460 }, // xylulose-5-P

  // --- glycogen, left of G6P ---
  "CHEBI:58601": { x: -240, y: 160 }, // glucose-1-P
  "CHEBI:58885": { x: -400, y: 160 }, // UDP-glucose

  // --- amino-acid entry points ---
  "CHEBI:57972": { x: 250, y: 1340 }, // L-alanine (↔ pyruvate)
  "CHEBI:29985": { x: 620, y: 2050 }, // L-glutamate (↔ 2-OG)
  "CHEBI:29991": { x: -300, y: 1580 }, // L-aspartate (↔ OAA)

  // --- lipid synthesis, right of acetyl-CoA ---
  "CHEBI:57384": { x: 470, y: 1500 }, // malonyl-CoA
  "CHEBI:57379": { x: 720, y: 1500 }, // palmitoyl-CoA
  "CHEBI:7896": { x: 720, y: 1340 }, // palmitate
  "CHEBI:57597": { x: 340, y: 760 }, // glycerol-3-phosphate (DHAP → lipids)

  // --- urea cycle, lower-right block ---
  "CHEBI:46911": { x: 640, y: 2320 }, // ornithine
  "CHEBI:57743": { x: 640, y: 2480 }, // citrulline
  "CHEBI:57472": { x: 470, y: 2580 }, // argininosuccinate
  "CHEBI:32682": { x: 300, y: 2480 }, // arginine
  "CHEBI:16199": { x: 300, y: 2320 }, // urea
};

/** TCA ring: 8 members evenly on a circle, OAA at the top, clockwise. */
const TCA_CENTER: Point = { x: 170, y: 1880 };
const TCA_R = 260;
const TCA_ORDER = [
  "CHEBI:16452", // oxaloacetate (top)
  "CHEBI:16947", // citrate
  "CHEBI:15562", // isocitrate
  "CHEBI:16810", // 2-oxoglutarate
  "CHEBI:57292", // succinyl-CoA
  "CHEBI:30031", // succinate
  "CHEBI:29806", // fumarate
  "CHEBI:15589", // malate
];
for (let i = 0; i < TCA_ORDER.length; i++) {
  const a = (-90 + i * (360 / TCA_ORDER.length)) * (Math.PI / 180);
  RAW[TCA_ORDER[i]!] = { x: TCA_CENTER.x + TCA_R * Math.cos(a), y: TCA_CENTER.y + TCA_R * Math.sin(a) };
}

/** chebiId -> fixed world position (scaled). */
export const SKELETON: ReadonlyMap<string, Point> = new Map(
  Object.entries(RAW).map(([chebi, p]) => [chebi, { x: p.x * SCALE, y: p.y * SCALE }]),
);

/** Visual zones drawn as soft pastel backgrounds behind their metabolites. */
export interface Zone {
  id: string;
  label: string;
  /** CSS variable name holding the tint colour */
  tint: string;
  /** chebi ids whose bounding box (padded) defines the zone */
  members: string[];
}

export const ZONES: Zone[] = [
  { id: "glycolysis", label: "Гликолиз / глюконеогенез", tint: "--zone-carb", members: ["CHEBI:4167", "CHEBI:58225", "CHEBI:32966", "CHEBI:59776", "CHEBI:58702", "CHEBI:15361"] },
  { id: "tca", label: "Цикл Кребса", tint: "--zone-tca", members: TCA_ORDER },
  { id: "ppp", label: "Пентозофосфатный путь", tint: "--zone-ppp", members: ["CHEBI:57955", "CHEBI:58759", "CHEBI:58121", "CHEBI:78346", "CHEBI:57737"] },
  { id: "lipid", label: "Синтез липидов", tint: "--zone-lipid", members: ["CHEBI:57384", "CHEBI:57379", "CHEBI:7896"] },
  { id: "urea", label: "Цикл мочевины", tint: "--zone-urea", members: ["CHEBI:46911", "CHEBI:57743", "CHEBI:57472", "CHEBI:32682", "CHEBI:16199"] },
];

export function skeletonPosition(chebiId: string | undefined): Point | undefined {
  return chebiId ? SKELETON.get(chebiId) : undefined;
}

/** Geometric centre of the skeleton — a sensible fallback spot for nodes with no fixed neighbour. */
export const SKELETON_CENTER: Point = (() => {
  const pts = [...SKELETON.values()];
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
})();

// ---------------------------------------------------------------------------
// Per-device persistence of node positions (user drags + remembered layout).
// ---------------------------------------------------------------------------
const POS_KEY = "metabomap:positions:v2";
type PosStore = Record<string, Point>;

export function loadPositions(): PosStore {
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? (JSON.parse(raw) as PosStore) : {};
  } catch {
    return {};
  }
}

export function savePositions(store: PosStore): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable: positions simply aren't remembered */
  }
}

export function clearPositions(): void {
  try {
    localStorage.removeItem(POS_KEY);
  } catch {
    /* ignore */
  }
}
