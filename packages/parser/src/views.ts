import type {
  AST, DiagramNode, ServiceNode, ViewNode, Diagnostic, Edge,
} from './types.js';
import { resolveInheritance } from './inheritance.js';
import { inferEdges } from './edges.js';

type NodeKind = DiagramNode['kind'];

type IndexEntry = {
  qualified: string;
  kind: NodeKind;
  /** For services, the node itself so we can walk children when recursive. */
  node?: DiagramNode;
};

function isBodylessType(node: DiagramNode): boolean {
  return node.kind === 'Type' && node.fields.length === 0;
}

function buildIndex(nodes: DiagramNode[], prefix: string[], index: Map<string, IndexEntry>): void {
  for (const node of nodes) {
    if (node.kind === 'Service') {
      const qualified = [...prefix, node.name].join('::');
      index.set(qualified, { qualified, kind: 'Service', node });
      buildIndex(node.children, [...prefix, node.name], index);
    } else if (!isBodylessType(node)) {
      const qualified = [...prefix, node.name].join('::');
      index.set(qualified, { qualified, kind: node.kind });
    }
  }
}

function collectDescendants(
  service: ServiceNode,
  prefix: string[],
  visibleLeaves: Set<string>,
  visibleServices: Set<string>,
): void {
  for (const child of service.children) {
    const childPath = [...prefix, child.name];
    const childId = childPath.join('::');
    if (child.kind === 'Service') {
      visibleServices.add(childId);
      collectDescendants(child, childPath, visibleLeaves, visibleServices);
    } else if (!isBodylessType(child)) {
      visibleLeaves.add(childId);
    }
  }
}

function addAncestors(qualified: string, visibleServices: Set<string>): void {
  const parts = qualified.split('::');
  for (let i = 1; i < parts.length; i++) {
    visibleServices.add(parts.slice(0, i).join('::'));
  }
}

export type ResolvedView = {
  /** Qualified ids of visible leaf nodes. */
  visibleLeaves: Set<string>;
  /** Qualified ids of visible service containers. */
  visibleServices: Set<string>;
  warnings: Diagnostic[];
};

/**
 * Compute the visible-node set for a single View. Returns the qualified ids of
 * leaves and service containers that should render, plus any diagnostics
 * (unresolved includes, etc.).
 */
export function resolveView(ast: AST, view: ViewNode): ResolvedView {
  const inheritedAst = resolveInheritance(ast);
  const index = new Map<string, IndexEntry>();
  buildIndex(inheritedAst.nodes, [], index);

  const visibleLeaves = new Set<string>();
  const visibleServices = new Set<string>();
  const warnings: Diagnostic[] = [];

  const here = `View ${view.name}`;

  for (const entry of view.include) {
    const hit = index.get(entry.name);
    if (!hit) {
      warnings.push({
        severity: 'error',
        message: `${here}: include '${entry.name}' does not resolve to a known node`,
        line: entry.line,
      });
      continue;
    }
    addAncestors(hit.qualified, visibleServices);
    if (hit.kind === 'Service') {
      visibleServices.add(hit.qualified);
      if (entry.recursive && hit.node?.kind === 'Service') {
        collectDescendants(hit.node, hit.qualified.split('::'), visibleLeaves, visibleServices);
      }
    } else {
      if (entry.recursive) {
        warnings.push({
          severity: 'warning',
          message: `${here}: include '${entry.name}.*' is a ${hit.kind}, not a Service — '.*' has no effect`,
          line: entry.line,
        });
      }
      visibleLeaves.add(hit.qualified);
    }
  }

  return { visibleLeaves, visibleServices, warnings };
}

/**
 * Warn about visible nodes whose only incoming edges come from hidden nodes —
 * the reader will see e.g. an Event that nothing dispatches in the view.
 */
export function lintViewDanglingEdges(
  ast: AST,
  view: ViewNode,
  resolved: ResolvedView,
  edges: Edge[],
): Diagnostic[] {
  const warnings: Diagnostic[] = [];
  const here = `View ${view.name}`;

  const incomingTotal = new Map<string, number>();
  const incomingVisible = new Map<string, number>();
  for (const e of edges) {
    if (!resolved.visibleLeaves.has(e.to)) continue;
    incomingTotal.set(e.to, (incomingTotal.get(e.to) ?? 0) + 1);
    if (resolved.visibleLeaves.has(e.from)) {
      incomingVisible.set(e.to, (incomingVisible.get(e.to) ?? 0) + 1);
    }
  }

  for (const id of resolved.visibleLeaves) {
    const total = incomingTotal.get(id) ?? 0;
    const visible = incomingVisible.get(id) ?? 0;
    if (total > 0 && visible === 0) {
      warnings.push({
        severity: 'warning',
        message: `${here}: '${id}' has incoming references only from hidden nodes — it will appear isolated`,
      });
    }
  }
  return warnings;
}

/**
 * Convenience: run resolveView + dangling-edge lint and return combined diagnostics.
 */
export function lintViews(ast: AST): Diagnostic[] {
  if (!ast.views || ast.views.length === 0) return [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const edges = inferEdges(ast);
  for (const view of ast.views) {
    if (seen.has(view.name)) {
      diagnostics.push({
        severity: 'error',
        message: `View ${view.name}: duplicate View name`,
        line: view.line,
      });
      continue;
    }
    seen.add(view.name);
    const resolved = resolveView(ast, view);
    diagnostics.push(...resolved.warnings);
    diagnostics.push(...lintViewDanglingEdges(ast, view, resolved, edges));
  }
  return diagnostics;
}
