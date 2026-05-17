import type { AST, DiagramNode, Edge, EntityNode, EventHandlerNode, ActionNode, ActorNode, QueryNode } from './types.js';
import { isReference } from './parser.js';

type NodeIndex = Map<string, string>; // qualifiedName → XYFlow leaf node id

function buildIndex(nodes: DiagramNode[], prefix: string[]): NodeIndex {
  const index: NodeIndex = new Map();
  for (const node of nodes) {
    if (node.kind === 'Service') {
      const childIndex = buildIndex(node.children, [...prefix, node.name]);
      for (const [k, v] of childIndex) index.set(k, v);
    } else {
      const qualified = [...prefix, node.name].join('::');
      index.set(qualified, qualified);
    }
  }
  return index;
}

function resolve(name: string, prefix: string[], siblingMap: Map<string, string>, globalIndex: NodeIndex): string | undefined {
  const sibling = siblingMap.get(name);
  if (sibling) return sibling;
  // Walk up the scope chain: try the reference under each enclosing
  // scope, narrowest first, falling back to the global root.
  for (let i = prefix.length; i >= 0; i--) {
    const hit = globalIndex.get([...prefix.slice(0, i), name].join('::'));
    if (hit) return hit;
  }
  return undefined;
}

function collectEdges(
  nodes: DiagramNode[],
  prefix: string[],
  globalIndex: NodeIndex,
  edges: Edge[],
) {
  const siblingMap = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind !== 'Service') {
      siblingMap.set(node.name, [...prefix, node.name].join('::'));
    }
  }

  for (const node of nodes) {
    if (node.kind === 'Service') {
      collectEdges(node.children, [...prefix, node.name], globalIndex, edges);
      continue;
    }

    const fromId = [...prefix, node.name].join('::');

    if (node.kind === 'Entity') {
      for (const field of (node as EntityNode).fields) {
        if (isReference(field.type)) {
          const toId = resolve(field.type.base, prefix, siblingMap, globalIndex);
          if (toId) {
            edges.push({ from: fromId, to: toId, label: field.name, dashed: field.type.nullable || field.optional });
          }
        }
      }
    }

    if (node.kind === 'EventHandler') {
      const handler = node as EventHandlerNode;
      for (const eventName of handler.dispatch) {
        const toId = resolve(eventName, prefix, siblingMap, globalIndex);
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
      for (const eventName of action.dispatch) {
        const toId = resolve(eventName, prefix, siblingMap, globalIndex);
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
  const edges: Edge[] = [];
  const globalIndex = buildIndex(ast.nodes, []);
  collectEdges(ast.nodes, [], globalIndex, edges);
  return edges;
}
