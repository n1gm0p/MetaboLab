import type { StylesheetJson } from "cytoscape";

/** Stable colours for common cellular compartments (GO cellular component ids). */
const COMPARTMENT_COLORS: Record<string, string> = {
  "GO:0005829": "#0a84ff", // cytosol
  "GO:0005759": "#ff9f0a", // mitochondrial matrix
  "GO:0005758": "#ffb340", // mitochondrial intermembrane space
  "GO:0005743": "#e0861a", // mitochondrial inner membrane
  "GO:0005741": "#d4a017", // mitochondrial outer membrane
  "GO:0005576": "#30b0c7", // extracellular region
  "GO:0005615": "#30b0c7", // extracellular space
  "GO:0005788": "#bf5af2", // endoplasmic reticulum lumen
  "GO:0005789": "#a457d6", // ER membrane
  "GO:0005782": "#34c759", // peroxisomal matrix
  "GO:0005777": "#34c759", // peroxisome
  "GO:0005654": "#ff375f", // nucleoplasm
  "GO:0043202": "#ac8e68", // lysosomal lumen
  "GO:0005796": "#5e5ce6", // Golgi lumen
  "GO:0005886": "#8e8e93", // plasma membrane
};

export function compartmentColor(id: string | undefined): string {
  if (!id) return "#8e8e93";
  const known = COMPARTMENT_COLORS[id];
  if (known) return known;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 52%)`;
}

export interface Palette {
  ink: string;
  muted: string;
  canvas: string;
  node: string;
  line: string;
  accent: string;
  in: string;
  out: string;
  route: string;
}

export function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ink: v("--ink", "#1d1d1f"),
    muted: v("--muted", "#6e6e73"),
    canvas: v("--canvas", "#fbfbfd"),
    node: v("--panel-solid", "#ffffff"),
    line: v("--faint", "#a1a1a6"),
    accent: v("--accent", "#0071e3"),
    in: v("--in", "#0f9d76"),
    out: v("--out", "#e8710a"),
    route: v("--route", "#7c3aed"),
  };
}

export function buildStylesheet(p: Palette, touch = false): StylesheetJson {
  // larger targets for fingers (iPad / phones)
  const rxnSize = touch ? 22 : 16;
  const metHeight = touch ? 32 : 26;
  return [
    {
      selector: "node",
      style: {
        "font-family": "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        "transition-property": "opacity, border-width, background-color, border-color",
        "transition-duration": 150,
      },
    },
    {
      selector: "node[kind = 'metabolite']",
      style: {
        shape: "round-rectangle",
        width: "data(w)",
        height: metHeight,
        "background-color": p.node,
        "border-width": 1.5,
        "border-color": "data(color)",
        label: "data(display)",
        color: p.ink,
        "font-size": 11,
        "font-weight": 500,
        "text-valign": "center",
        "text-halign": "center",
        "text-max-width": "160px",
        "text-wrap": "ellipsis",
      },
    },
    {
      selector: "node[kind = 'metabolite'][?currency]",
      style: {
        height: 18,
        "font-size": 9,
        "border-width": 1,
        "border-style": "dashed",
        color: p.muted,
      },
    },
    {
      selector: "node[kind = 'reaction']",
      style: {
        shape: "round-diamond",
        width: rxnSize,
        height: rxnSize,
        "background-color": p.muted,
        "border-width": 0,
        label: "data(display)",
        "font-size": 8,
        color: p.muted,
        "text-valign": "bottom",
        "text-margin-y": 3,
      },
    },
    {
      selector: "node[kind = 'reaction'][?isTransport]",
      style: { shape: "round-rectangle", "background-color": "#30b0c7" },
    },
    {
      selector: "edge",
      style: {
        width: 1.4,
        "line-color": p.line,
        "target-arrow-color": p.line,
        "source-arrow-color": p.line,
        "curve-style": "bezier",
        "arrow-scale": 0.8,
        label: "data(stoichLabel)",
        "font-size": 9,
        color: p.muted,
        "text-background-color": p.canvas,
        "text-background-opacity": 1,
        "text-background-padding": "1px",
        opacity: 0.9,
      },
    },
    { selector: "edge[role = 'product']", style: { "target-arrow-shape": "triangle" } },
    { selector: "edge[role = 'substrate'][?reversible]", style: { "source-arrow-shape": "triangle" } },
    { selector: "edge[?currencyEdge]", style: { width: 1, "line-style": "dashed", opacity: 0.55 } },

    // --- interaction states ---
    { selector: ".faded", style: { opacity: 0.18 } },
    // dimmed context: a pathway is selected; the rest of the map recedes but stays visible
    { selector: ".dim", style: { opacity: 0.28 } },
    { selector: "node.dim", style: { "text-opacity": 0.45 } },
    {
      selector: "node.focus",
      style: { "border-width": 3, "border-color": p.accent, "background-color": p.node, "z-index": 10 },
    },
    { selector: "node[kind = 'reaction'].focus", style: { "background-color": p.accent, width: 22, height: 22 } },
    { selector: "node.in", style: { "background-color": p.in } },
    { selector: "node.out", style: { "background-color": p.out } },
    { selector: "edge.in", style: { "line-color": p.in, "target-arrow-color": p.in, "source-arrow-color": p.in, width: 2.4, opacity: 1 } },
    { selector: "edge.out", style: { "line-color": p.out, "target-arrow-color": p.out, "source-arrow-color": p.out, width: 2.4, opacity: 1 } },
    {
      selector: "node[kind = 'metabolite'].route",
      style: { "border-color": p.route, "border-width": 3, "z-index": 9 },
    },
    { selector: "node[kind = 'reaction'].route", style: { "background-color": p.route, width: 20, height: 20 } },
    {
      selector: "edge.route",
      style: { "line-color": p.route, "target-arrow-color": p.route, "source-arrow-color": p.route, width: 3.5, opacity: 1, "z-index": 9 },
    },
    { selector: "node.route-endpoint", style: { "background-color": p.route, color: "#ffffff" } },
    { selector: "node:active", style: { "overlay-opacity": 0.08, "overlay-color": p.accent } },
    { selector: "node:selected", style: { "overlay-opacity": 0 } },
  ];
}
