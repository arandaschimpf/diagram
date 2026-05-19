import type { Node, Edge } from '@xyflow/react';

const SERVICE_PADDING = 40;
const SERVICE_HEADER = 40;
const NODE_FALLBACK_W = 220;
const NODE_FALLBACK_H = 80;
const SERVICE_FALLBACK_W = 900;
const SERVICE_FALLBACK_H = 700;

const TYPE_PARTITION: Record<string, number> = {
  entity: 0,
  event: 1,
  eventhandler: 2,
  query: 3,
  action: 3,
  actor: 4,
};

type ElkNode = {
  id: string;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: ElkEdge[];
};

type ElkEdge = {
  id: string;
  sources: string[];
  targets: string[];
};

type ElkLayouted = ElkNode & {
  x?: number;
  y?: number;
  children?: ElkLayouted[];
};

type ElkInstance = {
  layout: (graph: ElkNode) => Promise<ElkLayouted>;
};

let elkPromise: Promise<ElkInstance> | null = null;

async function getElk(): Promise<ElkInstance> {
  if (!elkPromise) {
    elkPromise = import('elkjs/lib/elk.bundled.js').then(m => {
      const Ctor = (m.default ?? m) as unknown as new () => ElkInstance;
      return new Ctor();
    });
  }
  return elkPromise;
}

function nodeSize(n: Node): { width: number; height: number } {
  const measured = (n as { measured?: { width?: number; height?: number } }).measured;
  if (measured?.width && measured?.height) {
    return { width: measured.width, height: measured.height };
  }
  const w = typeof n.width === 'number' ? n.width : NODE_FALLBACK_W;
  const h = typeof n.height === 'number' ? n.height : NODE_FALLBACK_H;
  return { width: w, height: h };
}

function buildElkGraph(nodes: Node[], edges: Edge[]): ElkNode {
  const seenNodeIds = new Set<string>();
  const uniqueNodes = nodes.filter(n => {
    if (seenNodeIds.has(n.id)) return false;
    seenNodeIds.add(n.id);
    return true;
  });

  const services = uniqueNodes.filter(n => n.type === 'service');
  const leaves = uniqueNodes.filter(n => n.type !== 'service');

  const elkById = new Map<string, ElkNode>();

  for (const s of services) {
    const sw = typeof s.style?.width === 'number' ? s.style.width : SERVICE_FALLBACK_W;
    const sh = typeof s.style?.height === 'number' ? s.style.height : SERVICE_FALLBACK_H;
    const elk: ElkNode = {
      id: s.id,
      width: sw,
      height: sh,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.padding': `[top=${SERVICE_HEADER + SERVICE_PADDING},left=${SERVICE_PADDING},bottom=${SERVICE_PADDING},right=${SERVICE_PADDING}]`,
        'elk.layered.spacing.nodeNodeBetweenLayers': '60',
        'elk.spacing.nodeNode': '30',
        'elk.partitioning.activate': 'true',
      },
      children: [],
      edges: [],
    };
    elkById.set(s.id, elk);
  }

  for (const leaf of leaves) {
    const { width, height } = nodeSize(leaf);
    const partition = TYPE_PARTITION[leaf.type ?? ''] ?? 5;
    const elk: ElkNode = {
      id: leaf.id,
      width,
      height,
      layoutOptions: {
        'elk.partitioning.partition': String(partition),
      },
    };
    elkById.set(leaf.id, elk);
  }

  for (const s of services) {
    const parent = s.parentId ? elkById.get(s.parentId) : null;
    if (parent) parent.children!.push(elkById.get(s.id)!);
  }
  for (const leaf of leaves) {
    const parent = leaf.parentId ? elkById.get(leaf.parentId) : null;
    if (parent) parent.children!.push(elkById.get(leaf.id)!);
  }

  const rootChildren: ElkNode[] = [];
  for (const n of uniqueNodes) {
    if (!n.parentId) rootChildren.push(elkById.get(n.id)!);
  }

  // Edges are placed in the lowest common ancestor (or root). For simplicity put all at root —
  // ELK accepts cross-hierarchy edges when 'elk.hierarchyHandling' is INCLUDE_CHILDREN.
  const rootEdges: ElkEdge[] = edges.map((e, i) => ({
    id: `e${i}`,
    sources: [e.source],
    targets: [e.target],
  }));

  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '50',
      'elk.padding': '[top=20,left=20,bottom=20,right=20]',
    },
    children: rootChildren,
    edges: rootEdges,
  };
}

export type LayoutResult = Map<string, { x: number; y: number; width?: number; height?: number }>;

function collect(elk: ElkLayouted, out: LayoutResult, isService: (id: string) => boolean) {
  if (elk.id !== 'root') {
    const entry: { x: number; y: number; width?: number; height?: number } = {
      x: elk.x ?? 0,
      y: elk.y ?? 0,
    };
    if (isService(elk.id)) {
      entry.width = elk.width;
      entry.height = elk.height;
    }
    out.set(elk.id, entry);
  }
  for (const c of elk.children ?? []) collect(c, out, isService);
}

export async function computeAutoLayout(nodes: Node[], edges: Edge[]): Promise<LayoutResult> {
  const elk = await getElk();
  const graph = buildElkGraph(nodes, edges);
  const result = await elk.layout(graph);
  const serviceIds = new Set(nodes.filter(n => n.type === 'service').map(n => n.id));
  const out: LayoutResult = new Map();
  collect(result, out, id => serviceIds.has(id));
  return out;
}
