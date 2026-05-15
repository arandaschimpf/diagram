import { parse, inferEdges } from '@diagram/parser';
import type { AST, DiagramNode } from '@diagram/parser';
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
      data: { name: node.name, external: node.external },
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

export function dslToFlow(src: string, layout: Layout): { nodes: Node[]; edges: Edge[]; ast: AST | null } {
  let ast: AST;
  try {
    ast = parse(src);
  } catch {
    return { nodes: [], edges: [], ast: null };
  }

  const xyNodes: Node[] = [];
  const counter = { value: 0 };
  processNodes(ast.nodes, [], undefined, layout, counter, xyNodes);

  const edges: Edge[] = [];
  const inferred = inferEdges(ast);
  for (const e of inferred) {
    const fromNode = xyNodes.find(n => n.id === e.from && n.type !== 'service');
    const toNode = xyNodes.find(n => n.id === e.to && n.type !== 'service');
    if (!fromNode || !toNode) continue;
    edges.push({
      id: `e-${fromNode.id}-${toNode.id}-${e.label ?? ''}`,
      source: fromNode.id,
      target: toNode.id,

      style: e.dashed ? { strokeDasharray: '5,5' } : undefined,
      type: 'smoothstep',
    });
  }

  return { nodes: xyNodes, edges, ast };
}

export function flowToAst(nodes: Node[], currentAst: AST): AST {
  return currentAst;
}
