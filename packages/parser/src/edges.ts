import type { AST, DiagramNode, Edge, EntityNode, EventHandlerNode, ActionNode, ActorNode, QueryNode } from './types.js';
import { isReference } from './parser.js';

type NodeIndex = Map<string, string>; // qualifiedName → XYFlow leaf node id

function buildIndex(nodes: DiagramNode[], prefix: string[]): NodeIndex {
  const index: NodeIndex = new Map();
  for (const node of nodes) {
    if (node.kind === 'Service') {
      const childIndex = buildIndex(node.children, [...prefix, node.name]);
      for (const [k, v] of childIndex) index.set(k, v);
    } else if (node.kind !== 'Primitive') {
      const qualified = [...prefix, node.name].join('::');
      index.set(qualified, qualified);
    }
  }
  return index;
}

function collectPrimitives(nodes: DiagramNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === 'Service') collectPrimitives(node.children, out);
    else if (node.kind === 'Primitive') out.add(node.name);
  }
}

function resolve(name: string, prefix: string[], siblingMap: Map<string, string>, globalIndex: NodeIndex): string | undefined {
  // Strip a trailing '.<suffix>' (e.g. `OrderStatus.Transition`) before lookup;
  // the suffix is informational and not part of the node identity.
  const dot = name.indexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const sibling = siblingMap.get(base);
  if (sibling) return sibling;
  // Walk up the scope chain: try the reference under each enclosing
  // scope, narrowest first, falling back to the global root.
  for (let i = prefix.length; i >= 0; i--) {
    const hit = globalIndex.get([...prefix.slice(0, i), base].join('::'));
    if (hit) return hit;
  }
  return undefined;
}

function collectEdges(
  nodes: DiagramNode[],
  prefix: string[],
  globalIndex: NodeIndex,
  userPrimitives: Set<string>,
  edges: Edge[],
) {
  const siblingMap = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind !== 'Service' && node.kind !== 'Primitive') {
      siblingMap.set(node.name, [...prefix, node.name].join('::'));
    }
  }

  for (const node of nodes) {
    if (node.kind === 'Service') {
      collectEdges(node.children, [...prefix, node.name], globalIndex, userPrimitives, edges);
      continue;
    }
    if (node.kind === 'Primitive') continue;

    const fromId = [...prefix, node.name].join('::');

    if (node.kind === 'Entity') {
      for (const field of (node as EntityNode).fields) {
        if (isReference(field.type) && !userPrimitives.has(field.type.base)) {
          const toId = resolve(field.type.base, prefix, siblingMap, globalIndex);
          if (toId) {
            edges.push({ from: fromId, to: toId, label: field.name, dashed: field.type.nullable || field.optional });
          }
        }
      }
    }

    if (node.kind === 'EventHandler') {
      const handler = node as EventHandlerNode;
      for (const d of handler.dispatch) {
        const toId = resolve(d.target, prefix, siblingMap, globalIndex);
        if (toId) edges.push({ from: fromId, to: toId, dashed: false });
      }
      for (const call of handler.calls) {
        const toId = resolve(call.target, prefix, siblingMap, globalIndex);
        if (toId) edges.push({ from: fromId, to: toId, dashed: false });
      }
    }

    if (node.kind === 'Action') {
      const action = node as ActionNode;
      for (const call of action.calls) {
        const toId = resolve(call.target, prefix, siblingMap, globalIndex);
        if (toId) edges.push({ from: fromId, to: toId, dashed: false });
      }
      for (const d of action.dispatch) {
        const toId = resolve(d.target, prefix, siblingMap, globalIndex);
        if (toId) edges.push({ from: fromId, to: toId, dashed: false });
      }
    }

    if (node.kind === 'Query') {
      for (const call of (node as QueryNode).calls) {
        const toId = resolve(call.target, prefix, siblingMap, globalIndex);
        if (toId) edges.push({ from: fromId, to: toId, dashed: false });
      }
    }

    if (node.kind === 'Actor') {
      for (const call of (node as ActorNode).calls) {
        const toId = resolve(call.target, prefix, siblingMap, globalIndex);
        if (toId) edges.push({ from: fromId, to: toId, dashed: false });
      }
    }
  }
}

export function inferEdges(ast: AST): Edge[] {
  const raw: Edge[] = [];
  const globalIndex = buildIndex(ast.nodes, []);
  const userPrimitives = new Set<string>();
  collectPrimitives(ast.nodes, userPrimitives);
  collectEdges(ast.nodes, [], globalIndex, userPrimitives, raw);
  // Collapse multiple references between the same (from, to) into one edge.
  // Label is kept only if all contributing edges share it. Dashed only if
  // every contributing edge is dashed.
  const byPair = new Map<string, Edge[]>();
  const order: string[] = [];
  for (const e of raw) {
    const key = `${e.from}|${e.to}`;
    if (!byPair.has(key)) {
      byPair.set(key, []);
      order.push(key);
    }
    byPair.get(key)!.push(e);
  }
  const out: Edge[] = [];
  for (const key of order) {
    const group = byPair.get(key)!;
    const first = group[0];
    const sameLabel = group.every(e => e.label === first.label);
    const allDashed = group.every(e => e.dashed === true);
    out.push({
      from: first.from,
      to: first.to,
      ...(sameLabel && first.label ? { label: first.label } : {}),
      dashed: allDashed,
    });
  }
  return out;
}
