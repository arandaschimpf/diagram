import { parse, inferEdges, resolveInheritance, resolveView, diffAst } from '@diagram/parser';
import type { AST, DiagramNode, ResolvedView, DiagramDiff, NodeDiffInfo } from '@diagram/parser';
import { MarkerType } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';

export type LayoutEntry = { x: number; y: number; width?: number; height?: number };
export type Layout = Record<string, LayoutEntry>;

const SPACING = { x: 250, y: 180 };

function defaultPosition(index: number): { x: number; y: number } {
  const col = index % 5;
  const row = Math.floor(index / 5);
  return { x: col * SPACING.x + 60, y: row * SPACING.y + 60 };
}

function processNodes(
  nodes: DiagramNode[],
  prefix: string[],
  parentServiceId: string | undefined,
  layout: Layout,
  counter: { value: number },
  result: Node[],
) {
  // Service containers first so they appear before their children in the array
  for (const node of nodes) {
    if (node.kind !== 'Service') continue;
    const path = [...prefix, node.name];
    const serviceId = `service::${path.join('::')}`;
    const entry = layout[serviceId] ?? { x: 20, y: 20 };
    result.push({
      id: serviceId,
      type: 'service',
      position: { x: entry.x, y: entry.y },
      data: {
        name: node.name,
        external: node.external,
        isInterface: node.isInterface,
        implements: node.implements,
        comment: node.comment,
      },
      ...(parentServiceId ? { parentId: parentServiceId, extent: 'parent' as const } : {}),
      style: {
        width: entry.width ?? 900,
        height: entry.height ?? 700,
        zIndex: -1,
      },
    });
    processNodes(node.children, path, serviceId, layout, counter, result);
  }

  // Then leaf nodes
  for (const node of nodes) {
    if (node.kind === 'Service') continue;
    if (node.kind === 'Type' && node.fields.length === 0) continue;
    const id = [...prefix, node.name].join('::');
    const pos = layout[id] ?? defaultPosition(counter.value++);
    result.push({
      id,
      type: node.kind.toLowerCase(),
      position: pos,
      data: { node, serviceId: prefix.join('::') },
      ...(parentServiceId ? { parentId: parentServiceId, extent: 'parent' as const } : {}),
    });
  }
}

export type ViewInfo = { name: string };

export function dslToFlow(
  src: string,
  layout: Layout,
  activeView?: string | null,
): { nodes: Node[]; edges: Edge[]; ast: AST | null; views: ViewInfo[]; viewMissing: boolean } {
  let ast: AST;
  try {
    ast = parse(src);
  } catch {
    return { nodes: [], edges: [], ast: null, views: [], viewMissing: false };
  }

  const inheritedAst = resolveInheritance(ast);
  const views: ViewInfo[] = (ast.views ?? []).map(v => ({ name: v.name }));

  let resolved: ResolvedView | null = null;
  let viewMissing = false;
  if (activeView) {
    const view = (ast.views ?? []).find(v => v.name === activeView);
    if (view) {
      resolved = resolveView(inheritedAst, view);
    } else {
      viewMissing = true;
    }
  }

  // When a view is active, ignore the saved layout — positions are computed
  // by auto-layout each time the view is opened (decision: shared layout,
  // auto-compact on the fly, no per-view persistence).
  const effectiveLayout = resolved ? {} : layout;

  const xyNodes: Node[] = [];
  const counter = { value: 0 };
  processNodes(inheritedAst.nodes, [], undefined, effectiveLayout, counter, xyNodes);

  let filteredNodes = xyNodes;
  if (resolved) {
    filteredNodes = xyNodes.filter(n => {
      if (n.type === 'service') {
        return resolved!.visibleServices.has(n.id.replace(/^service::/, ''));
      }
      return resolved!.visibleLeaves.has(n.id);
    });
  }

  const edges: Edge[] = [];
  const inferred = inferEdges(inheritedAst);
  for (const e of inferred) {
    if (resolved && !(resolved.visibleLeaves.has(e.from) && resolved.visibleLeaves.has(e.to))) continue;
    const fromNode = filteredNodes.find(n => n.id === e.from && n.type !== 'service');
    const toNode = filteredNodes.find(n => n.id === e.to && n.type !== 'service');
    if (!fromNode || !toNode) continue;
    const color = e.dashed ? '#7a9ab8' : '#5b9bd5';
    edges.push({
      id: `e-${fromNode.id}-${toNode.id}-${e.label ?? ''}`,
      source: fromNode.id,
      target: toNode.id,
      type: 'bezier',
      style: {
        stroke: color,
        strokeWidth: 1.5,
        ...(e.dashed ? { strokeDasharray: '6,4' } : {}),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 14,
        height: 14,
      },
    });
  }

  return { nodes: filteredNodes, edges, ast, views, viewMissing };
}

export function flowToAst(nodes: Node[], currentAst: AST): AST {
  return currentAst;
}

// ── Diff mode ──────────────────────────────────────────────────────────────────

const DIM_EDGE_OPACITY = 0.22;
const GHOST_EDGE_COLOR = '#f85149';

export type DiffFlowResult = {
  nodes: Node[];
  edges: Edge[];
  /** Number of added/removed/modified/renamed nodes — 0 means clean working tree. */
  changeCount: number;
  /** True when the file does not exist at HEAD (everything reads as added). */
  isNewFile: boolean;
  /** True when current or HEAD source failed to parse. */
  parseError: boolean;
};

const EMPTY_DIFF_RESULT: DiffFlowResult = {
  nodes: [], edges: [], changeCount: 0, isNewFile: false, parseError: true,
};

function annotate(node: Node, info: NodeDiffInfo | undefined, diff: DiagramDiff): Node {
  let resolved = info;
  if (!resolved) {
    resolved = node.type === 'service' && diff.changedAncestors.has(node.id)
      ? { status: 'ancestor' }
      : { status: 'unchanged' };
  }
  return { ...node, data: { ...node.data, diff: resolved }, draggable: false };
}

function buildGhostNodes(diff: DiagramDiff, headLayout: Layout, existing: Set<string>): Node[] {
  const ghosts: Node[] = [];
  const services = diff.removed.filter(r => r.isService)
    .sort((a, b) => a.parentPath.length - b.parentPath.length);
  const leaves = diff.removed.filter(r => !r.isService);

  const counter = { value: 0 };
  const make = (entry: typeof diff.removed[number]): Node | null => {
    const node = entry.node;
    const parentCandidate = entry.parentPath.length
      ? `service::${entry.parentPath.join('::')}`
      : undefined;
    const parented = parentCandidate && existing.has(parentCandidate);
    const lay = headLayout[entry.id];

    if (entry.isService) {
      const pos = lay ?? { x: 20, y: 20 };
      return {
        id: entry.id,
        type: 'service',
        position: { x: pos.x, y: pos.y },
        data: {
          name: node.name,
          external: node.kind === 'Service' ? node.external : false,
          isInterface: node.kind === 'Service' ? node.isInterface : false,
          implements: node.kind === 'Service' ? node.implements : undefined,
          comment: node.comment,
          diff: { status: 'removed' } as NodeDiffInfo,
        },
        ...(parented ? { parentId: parentCandidate } : {}),
        style: { width: lay?.width ?? 900, height: lay?.height ?? 700, zIndex: -1 },
        draggable: false,
        selectable: true,
      };
    }
    if (node.kind === 'Type' && node.fields.length === 0) return null;
    const pos = lay ?? defaultPosition(counter.value++);
    return {
      id: entry.id,
      type: node.kind.toLowerCase(),
      position: { x: pos.x, y: pos.y },
      data: {
        node,
        serviceId: entry.parentPath.join('::'),
        diff: { status: 'removed', oldNode: node } as NodeDiffInfo,
      },
      ...(parented ? { parentId: parentCandidate } : {}),
      draggable: false,
      selectable: true,
    };
  };

  for (const s of services) {
    const n = make(s);
    if (n) { ghosts.push(n); existing.add(n.id); }
  }
  for (const l of leaves) {
    const n = make(l);
    if (n) { ghosts.push(n); existing.add(n.id); }
  }
  return ghosts;
}

/**
 * Build the canvas for diff mode: working copy vs HEAD. Current nodes are tagged
 * with their diff status, removed nodes appear as ghosts at their HEAD position,
 * and edges are dimmed (ghost-touching edges drawn faded-red). View filtering is
 * intentionally not applied in diff mode.
 */
export function dslToFlowDiff(
  currentSrc: string,
  currentLayout: Layout,
  headSrc: string | null,
  headLayout: Layout,
): DiffFlowResult {
  let currentAst: AST;
  try {
    currentAst = resolveInheritance(parse(currentSrc));
  } catch {
    return EMPTY_DIFF_RESULT;
  }

  const isNewFile = headSrc == null;
  let headAst: AST = { nodes: [] };
  if (headSrc != null) {
    try {
      headAst = resolveInheritance(parse(headSrc));
    } catch {
      return { ...EMPTY_DIFF_RESULT, parseError: true };
    }
  }

  const diff = diffAst(headAst, currentAst);

  // Current nodes (full diagram, no view filter).
  const currentNodes: Node[] = [];
  processNodes(currentAst.nodes, [], undefined, currentLayout, { value: 0 }, currentNodes);
  const annotated = currentNodes.map(n => annotate(n, diff.current.get(n.id), diff));

  const existing = new Set(annotated.map(n => n.id));
  const ghosts = buildGhostNodes(diff, headLayout, existing);
  const nodes = [...annotated, ...ghosts];

  const idSet = new Set(nodes.filter(n => n.type !== 'service').map(n => n.id));
  const removedIds = new Set(diff.removed.filter(r => !r.isService).map(r => r.id));

  const edges: Edge[] = [];

  // Current edges, dimmed.
  for (const e of inferEdges(currentAst)) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    const color = e.dashed ? '#7a9ab8' : '#5b9bd5';
    edges.push({
      id: `e-${e.from}-${e.to}-${e.label ?? ''}`,
      source: e.from,
      target: e.to,
      type: 'bezier',
      style: {
        stroke: color,
        strokeWidth: 1.5,
        opacity: DIM_EDGE_OPACITY,
        ...(e.dashed ? { strokeDasharray: '6,4' } : {}),
      },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
    });
  }

  // Removed edges touching a ghost node, faded red.
  for (const e of inferEdges(headAst)) {
    if (!(removedIds.has(e.from) || removedIds.has(e.to))) continue;
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    edges.push({
      id: `rm-${e.from}-${e.to}-${e.label ?? ''}`,
      source: e.from,
      target: e.to,
      type: 'bezier',
      style: { stroke: GHOST_EDGE_COLOR, strokeWidth: 1.5, opacity: 0.5, strokeDasharray: '5,4' },
      markerEnd: { type: MarkerType.ArrowClosed, color: GHOST_EDGE_COLOR, width: 14, height: 14 },
    });
  }

  return { nodes, edges, changeCount: countChanges(diff), isNewFile, parseError: false };
}

function countChanges(diff: DiagramDiff): number {
  let n = diff.removed.filter(r => !r.isService).length;
  for (const info of diff.current.values()) {
    if (info.status === 'added' || info.status === 'modified' || info.status === 'renamed') n++;
  }
  return n;
}
