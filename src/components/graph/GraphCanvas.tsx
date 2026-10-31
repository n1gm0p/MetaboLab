"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import cytoscape, { type Core, type ElementDefinition, type EventObject, type LayoutOptions } from "cytoscape";
import dagre from "cytoscape-dagre";
import fcose from "cytoscape-fcose";
import type { GraphModel, GraphNode } from "@/lib/graph/build";
import { metaboliteNodeId, reactionNodeId } from "@/lib/graph/build";
import type { RoutePath } from "@/lib/graph/route";
import type { EntityRef } from "@/lib/model/types";
import type { DetailMode, LayoutMode } from "@/components/state/app-state";
import { clearPositions, loadPositions, savePositions, skeletonPosition, SKELETON_CENTER, type Point } from "@/lib/graph/skeleton";
import { buildStylesheet, compartmentColor, readPalette } from "./graph-style";

const isTouch = () => window.matchMedia("(pointer: coarse)").matches;

let registered = false;
function ensureExtensions() {
  if (registered) return;
  cytoscape.use(dagre);
  cytoscape.use(fcose);
  registered = true;
}

export interface NodeMenuRequest {
  node: GraphNode;
  x: number;
  y: number;
}

export interface GraphCanvasProps {
  model: GraphModel;
  focus: EntityRef | null;
  routePath: RoutePath | null;
  quizMode: boolean;
  /** "student" hides cofactors until zoomed in; "pro" keeps them visible */
  detailMode: DetailMode;
  layout: LayoutMode;
  layoutNonce: number;
  fitNonce: number;
  /** bumped to clear saved positions and re-seed the fixed teaching skeleton */
  resetNonce: number;
  /** reactions to keep bright; everything else is dimmed (not removed). null = no dimming */
  dimReactionIds: ReadonlySet<string> | null;
  expandAnchor?: string;
  onSelect: (node: GraphNode) => void;
  onExpand: (node: GraphNode) => void;
  onBackgroundTap: () => void;
  onNodeMenu: (req: NodeMenuRequest) => void;
}

function displayLabel(n: GraphNode, quiz: boolean): string {
  if (!quiz) return n.label;
  if (n.kind === "reaction") return "";
  return n.currency ? n.label : "?";
}

/** Node width from label length (cytoscape's `width: label` is deprecated). */
function nodeWidth(n: GraphNode, label: string): number {
  if (n.kind !== "metabolite") return 16;
  const shown = Math.min(label.length, 26);
  return n.currency ? Math.max(24, shown * 5.6 + 12) : Math.max(36, shown * 6.6 + 22);
}

function toElements(model: GraphModel, quiz: boolean): ElementDefinition[] {
  const currencyNodes = new Set(model.nodes.filter((n) => n.currency).map((n) => n.id));
  return [
    ...model.nodes.map((n) => ({
      group: "nodes" as const,
      data: {
        ...n,
        display: displayLabel(n, quiz),
        w: nodeWidth(n, displayLabel(n, quiz)),
        color: compartmentColor(n.compartmentId),
      },
    })),
    ...model.edges.map((e) => ({
      group: "edges" as const,
      data: {
        ...e,
        stoichLabel: e.stoichiometry !== 1 ? String(e.stoichiometry) : "",
        currencyEdge: currencyNodes.has(e.source) || currencyNodes.has(e.target),
      },
    })),
  ];
}

function layoutOptions(
  mode: LayoutMode,
  size: number,
  incremental: boolean,
  fixed: { nodeId: string; position: Point }[],
): LayoutOptions {
  const animate = size < 500;
  // Hierarchical (dagre) is a manual alternative; it cannot honour fixed anchors.
  if (mode === "hierarchical" && !incremental) {
    return {
      name: "dagre",
      rankDir: "TB",
      nodeSep: 22,
      rankSep: 38,
      edgeSep: 8,
      ranker: "network-simplex",
      animate,
      animationDuration: 350,
      fit: true,
      padding: 40,
    } as LayoutOptions;
  }
  // Default "organic" layout: force-directed, but the teaching skeleton (glycolysis line,
  // TCA ring, pathway zones) is PINNED, so those nodes never move and only the free nodes
  // (reaction nodes, peripheral metabolites) settle around them.
  return {
    name: "fcose",
    quality: size > 1200 ? "draft" : "default",
    randomize: false,
    animate,
    animationDuration: 450,
    fit: !incremental,
    padding: 60,
    // free nodes (reaction nodes, cofactors, peripheral metabolites) hug the pinned skeleton;
    // they are pre-seeded next to their neighbours, so this is only a gentle local de-overlap.
    nodeRepulsion: 2600,
    idealEdgeLength: 46,
    edgeElasticity: 0.5,
    nodeSeparation: 46,
    gravity: 0,
    numIter: 1200,
    packComponents: false,
    fixedNodeConstraint: fixed.length ? fixed : undefined,
  } as LayoutOptions;
}

/** Move every non-fixed node next to the centroid of its already-placed neighbours (two bipartite
 *  passes: reactions anchor off metabolites, then metabolites off reactions). Keeps the force pass
 *  local so the fixed skeleton dominates the picture instead of being lost among scattered nodes. */
function seedFreeNodes(cy: Core, anchorOf: (d: GraphNode) => Point | undefined) {
  const placed = new Set<string>();
  cy.nodes().forEach((n) => {
    if (anchorOf(n.data() as GraphNode)) placed.add(n.id());
  });
  const seed = (selector: string) => {
    cy.nodes(selector).forEach((n) => {
      if (placed.has(n.id())) return;
      const refs = n.neighborhood("node").filter((m) => placed.has(m.id()));
      if (refs.empty()) return;
      let sx = 0;
      let sy = 0;
      refs.forEach((m) => {
        sx += m.position("x");
        sy += m.position("y");
      });
      n.position({ x: sx / refs.length + (Math.random() - 0.5) * 26, y: sy / refs.length + (Math.random() - 0.5) * 26 });
      placed.add(n.id());
    });
  };
  cy.batch(() => {
    seed('[kind = "reaction"]');
    seed('[kind = "metabolite"]');
    seed('[kind = "reaction"]'); // reactions whose metabolite neighbours were only placed in pass 2
  });
}

export default function GraphCanvas(props: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const handlers = useRef(props);
  useLayoutEffect(() => {
    handlers.current = props;
  });
  const lastTapped = useRef<string | null>(null);
  const appliedLayoutNonce = useRef(-1);
  const appliedResetNonce = useRef(0);
  const savedPos = useRef<Record<string, Point>>({});
  const applyDetail = useRef<() => void>(() => {});
  const [themeTick, setThemeTick] = useState(0);

  // --- init once ---
  useEffect(() => {
    ensureExtensions();
    const el = containerRef.current;
    if (!el) return;
    const cy = cytoscape({
      container: el,
      style: buildStylesheet(readPalette(el), isTouch()),
      minZoom: 0.08,
      maxZoom: 3,
      boxSelectionEnabled: false,
      autoungrabify: false,
      selectionType: "single",
      pixelRatio: "auto",
    });
    cyRef.current = cy;
    savedPos.current = loadPositions();

    // Remember where the user drags a node (per device).
    cy.on("dragfree", "node", (evt) => {
      const n = evt.target;
      savedPos.current[n.id()] = { x: n.position("x"), y: n.position("y") };
      savePositions(savedPos.current);
    });

    // Semantic zoom: when zoomed out, cofactor chips/arcs recede so only the main backbone and
    // pathway zones read; zooming in brings them back. The threshold depends on the detail mode:
    // "pro" keeps cofactors much longer than "student".
    let cofBand: "hidden" | "shown" | null = null;
    const detail = () => {
      const z = cy.zoom();
      const threshold = handlers.current.detailMode === "pro" ? 0.45 : 0.95;
      const band = z < threshold ? "hidden" : "shown";
      if (band === cofBand) return;
      cofBand = band;
      cy.batch(() => {
        const cof = cy.elements('node[?currency], edge[?currencyEdge]');
        if (band === "hidden") cof.addClass("cof-hidden");
        else cof.removeClass("cof-hidden");
      });
    };
    applyDetail.current = () => {
      cofBand = null;
      detail();
    };
    cy.on("zoom", detail);

    const nodeData = (evt: EventObject) => evt.target.data() as GraphNode;
    cy.on("tap", "node", (evt) => {
      const n = nodeData(evt);
      lastTapped.current = n.refId;
      handlers.current.onSelect(n);
    });
    cy.on("dbltap", "node", (evt) => handlers.current.onExpand(nodeData(evt)));
    const menu = (evt: EventObject) => {
      const pos = evt.renderedPosition ?? evt.target.renderedPosition();
      handlers.current.onNodeMenu({ node: nodeData(evt), x: pos.x, y: pos.y });
    };
    cy.on("cxttap", "node", menu);
    cy.on("taphold", "node", menu);
    cy.on("tap", (evt) => {
      if (evt.target === cy) handlers.current.onBackgroundTap();
    });

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => setThemeTick((t) => t + 1);
    mq.addEventListener("change", onTheme);
    const ro = new ResizeObserver(() => cy.resize());
    ro.observe(el);
    return () => {
      mq.removeEventListener("change", onTheme);
      ro.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // --- theme ---
  useEffect(() => {
    const cy = cyRef.current;
    const el = containerRef.current;
    if (cy && el && themeTick > 0) cy.style(buildStylesheet(readPalette(el), isTouch()));
  }, [themeTick]);

  // fixed world position of a node if it belongs to the teaching skeleton or the user moved it
  const anchorOf = (data: GraphNode): Point | undefined => {
    const saved = savedPos.current[data.id];
    if (saved) return saved;
    if (data.kind === "metabolite" && !data.clone) return skeletonPosition(data.chebiId);
    return undefined;
  };

  // --- sync elements (diff) + layout ---
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const els = toElements(props.model, props.quizMode);
    const wanted = new Set(els.map((e) => e.data.id as string));
    const anchor = props.expandAnchor ? cy.getElementById(props.expandAnchor) : null;
    const anchorPos = anchor && anchor.nonempty() ? anchor.position() : null;
    let added = 0;
    cy.batch(() => {
      cy.elements().forEach((ele) => {
        if (!wanted.has(ele.id())) ele.remove();
      });
      for (const e of els) {
        const id = e.data.id as string;
        const existing = cy.getElementById(id);
        if (existing.nonempty()) {
          existing.data(e.data);
          continue;
        }
        if (e.group === "nodes") {
          // Place new nodes at their remembered spot, then their fixed skeleton spot, then
          // near the node that was just expanded — so the backbone is reproducible.
          const fixed = anchorOf(e.data as GraphNode);
          const base = fixed ?? anchorPos ?? SKELETON_CENTER;
          const r = fixed ? 0 : 70;
          const angle = Math.random() * Math.PI * 2;
          e.position = { x: base.x + Math.cos(angle) * r, y: base.y + Math.sin(angle) * r };
        }
        cy.add(e);
        added++;
      }
    });
    if (appliedLayoutNonce.current !== props.layoutNonce && cy.nodes().length > 0) {
      appliedLayoutNonce.current = props.layoutNonce;
      const incremental = !!anchorPos && added < cy.nodes().length;
      const fixed = cy
        .nodes()
        .map((n) => {
          const p = anchorOf(n.data() as GraphNode);
          return p ? { nodeId: n.id(), position: p } : null;
        })
        .filter((x): x is { nodeId: string; position: Point } => x !== null);
      // Seed free nodes at the centroid of their fixed neighbours so the force pass stays local
      // and the backbone/ring is not dwarfed by scattered reaction nodes.
      if (!incremental && fixed.length) seedFreeNodes(cy, anchorOf);
      cy.layout(layoutOptions(props.layout, cy.nodes().length, incremental, fixed)).run();
    }
    applyDetail.current(); // class freshly added cofactor nodes/edges for the current zoom + mode
  }, [props.model, props.layout, props.layoutNonce, props.expandAnchor, props.quizMode]);

  // --- detail mode (student/pro): re-evaluate cofactor visibility threshold ---
  useEffect(() => {
    applyDetail.current();
  }, [props.detailMode]);

  // --- reset positions to the fixed teaching skeleton ---
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || props.resetNonce === appliedResetNonce.current) return;
    appliedResetNonce.current = props.resetNonce;
    if (props.resetNonce === 0) return;
    clearPositions();
    savedPos.current = {};
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const p = skeletonPosition(n.data("chebiId"));
        if (p && n.data("kind") === "metabolite" && !n.data("clone")) n.position({ ...p });
      });
    });
    const fixed = cy
      .nodes()
      .map((n) => {
        const p = skeletonPosition(n.data("chebiId"));
        return p && n.data("kind") === "metabolite" && !n.data("clone") ? { nodeId: n.id(), position: p } : null;
      })
      .filter((x): x is { nodeId: string; position: Point } => x !== null);
    cy.layout(layoutOptions("organic", cy.nodes().length, false, fixed)).run();
  }, [props.resetNonce]);

  // --- dimming: when a pathway is selected it stays bright, the rest of the map is dimmed
  //     (not removed), so the student keeps the whole context ---
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("dim");
      const bright = props.dimReactionIds;
      if (!bright || bright.size === 0) return;
      cy.nodes('[kind = "reaction"]').forEach((n) => {
        if (!bright.has(n.data("refId") as string)) n.addClass("dim");
      });
      cy.edges().forEach((e) => {
        if (!bright.has(e.data("reactionId") as string)) e.addClass("dim");
      });
      cy.nodes('[kind = "metabolite"]').forEach((n) => {
        const touchesBright = n.connectedEdges().some((e) => bright.has(e.data("reactionId") as string));
        if (!touchesBright) n.addClass("dim");
      });
    });
  }, [props.dimReactionIds, props.model]);

  // --- quiz labels ---
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const label = displayLabel(n.data() as GraphNode, props.quizMode);
        n.data({ display: label, w: nodeWidth(n.data() as GraphNode, label) });
      });
    });
  }, [props.quizMode]);

  // --- fit ---
  useEffect(() => {
    const cy = cyRef.current;
    if (cy && props.fitNonce > 0) cy.animate({ fit: { eles: cy.elements(), padding: 40 }, duration: 300 });
  }, [props.fitNonce]);

  // --- highlight focus neighbourhood / route ---
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("focus in out faded route route-endpoint");
      const route = props.routePath;
      if (route && route.steps.length) {
        const ids: string[] = [];
        for (const s of route.steps) {
          const r = reactionNodeId(s.reactionId);
          ids.push(r, metaboliteNodeId(s.fromId), metaboliteNodeId(s.toId));
          if (s.direction === "forward") ids.push(`s:${s.fromId}:${s.reactionId}`, `p:${s.toId}:${s.reactionId}`);
          else ids.push(`p:${s.fromId}:${s.reactionId}`, `s:${s.toId}:${s.reactionId}`);
        }
        let coll = cy.collection();
        for (const id of ids) coll = coll.union(cy.getElementById(id));
        if (coll.nonempty()) {
          cy.elements().addClass("faded");
          coll.removeClass("faded").addClass("route");
          const ends = [route.metaboliteIds[0], route.metaboliteIds.at(-1)];
          for (const m of ends) if (m) cy.getElementById(metaboliteNodeId(m)).addClass("route-endpoint");
        }
        return;
      }
      const f = props.focus;
      if (!f || (f.type !== "metabolite" && f.type !== "reaction")) return;
      if (f.type === "metabolite") {
        const nodes = cy.nodes().filter((n) => n.data("kind") === "metabolite" && n.data("refId") === f.id);
        if (nodes.empty()) return;
        cy.elements().addClass("faded");
        nodes.removeClass("faded").addClass("focus");
        nodes.incomers("edge").removeClass("faded").addClass("in");
        nodes.incomers("node").removeClass("faded").addClass("in");
        nodes.outgoers("edge").removeClass("faded").addClass("out");
        nodes.outgoers("node").removeClass("faded").addClass("out");
        // keep the other participants of those reactions readable
        nodes.neighborhood("node").closedNeighborhood().removeClass("faded");
      } else {
        const node = cy.getElementById(reactionNodeId(f.id));
        if (node.empty()) return;
        cy.elements().addClass("faded");
        node.removeClass("faded").addClass("focus");
        node.incomers().removeClass("faded").filter("edge").addClass("in");
        node.outgoers().removeClass("faded").filter("edge").addClass("out");
      }
    });
  }, [props.focus, props.routePath, props.model]);

  // --- center on focus chosen outside the map (search, cards) ---
  useEffect(() => {
    const cy = cyRef.current;
    const f = props.focus;
    if (!cy || !f) return;
    if (lastTapped.current === f.id) {
      lastTapped.current = null;
      return;
    }
    const target =
      f.type === "metabolite"
        ? cy.nodes().filter((n) => n.data("kind") === "metabolite" && n.data("refId") === f.id)
        : f.type === "reaction"
          ? cy.getElementById(reactionNodeId(f.id))
          : cy.collection();
    if (target.nonempty()) {
      // wait for a running layout to settle
      const t = setTimeout(() => cy.animate({ center: { eles: target }, zoom: Math.max(cy.zoom(), 1) }, { duration: 350 }), 420);
      return () => clearTimeout(t);
    }
  }, [props.focus]);

  // --- center on route ---
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !props.routePath) return;
    const t = setTimeout(() => {
      const coll = cy.elements(".route");
      if (coll.nonempty()) cy.animate({ fit: { eles: coll, padding: 60 }, duration: 350 });
    }, 450);
    return () => clearTimeout(t);
  }, [props.routePath]);

  // Cytoscape forces `position: relative` on its container, so it gets an explicitly sized wrapper.
  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="h-full w-full touch-none select-none"
        role="application"
        aria-label="Интерактивная карта метаболизма. Нажмите на узел, чтобы открыть карточку; двойное нажатие — раскрыть связи."
      />
    </div>
  );
}
