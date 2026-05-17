import type { AST, DiagramNode, Diagnostic } from './types.js';
import { isReference } from './parser.js';

type NodeKind = DiagramNode['kind'];

type IndexEntry = {
  qualified: string;
  kind: NodeKind;
};

function buildIndex(nodes: DiagramNode[], prefix: string[], index: Map<string, IndexEntry>): void {
  for (const node of nodes) {
    if (node.kind === 'Service') {
      buildIndex(node.children, [...prefix, node.name], index);
    } else {
      const qualified = [...prefix, node.name].join('::');
      index.set(qualified, { qualified, kind: node.kind });
    }
  }
}

function siblingsAt(nodes: DiagramNode[], prefix: string[]): Map<string, IndexEntry> {
  const siblings = new Map<string, IndexEntry>();
  for (const node of nodes) {
    if (node.kind === 'Service') continue;
    const qualified = [...prefix, node.name].join('::');
    siblings.set(node.name, { qualified, kind: node.kind });
  }
  return siblings;
}

function resolve(
  name: string,
  prefix: string[],
  siblings: Map<string, IndexEntry>,
  globalIndex: Map<string, IndexEntry>,
): IndexEntry | undefined {
  const sibling = siblings.get(name);
  if (sibling) return sibling;
  for (let i = prefix.length; i >= 0; i--) {
    const hit = globalIndex.get([...prefix.slice(0, i), name].join('::'));
    if (hit) return hit;
  }
  return undefined;
}

function lintNodes(
  nodes: DiagramNode[],
  prefix: string[],
  globalIndex: Map<string, IndexEntry>,
  diagnostics: Diagnostic[],
): void {
  const siblings = siblingsAt(nodes, prefix);

  for (const node of nodes) {
    if (node.kind === 'Service') {
      lintNodes(node.children, [...prefix, node.name], globalIndex, diagnostics);
      continue;
    }

    const here = `${node.kind} ${[...prefix, node.name].join('::')}`;

    if (node.kind === 'Entity') {
      const fieldNames = new Set(node.fields.map(f => f.name));
      for (const field of node.fields) {
        if (!isReference(field.type)) continue;
        const hit = resolve(field.type.base, prefix, siblings, globalIndex);
        if (!hit) {
          diagnostics.push({
            severity: 'warning',
            message: `${here}: field '${field.name}' references unknown type '${field.type.base}'`,
            line: field.line,
          });
        }
      }
      for (const c of node.constraints) {
        for (const f of c.fields) {
          if (!fieldNames.has(f)) {
            diagnostics.push({
              severity: 'warning',
              message: `${here}: @${c.kind} references unknown field '${f}'`,
              line: c.line,
            });
          }
        }
      }
    }

    if (node.kind === 'EventHandler' || node.kind === 'Action' || node.kind === 'Query' || node.kind === 'Actor') {
      for (const call of node.calls) {
        const hit = resolve(call.target, prefix, siblings, globalIndex);
        if (!hit) {
          diagnostics.push({
            severity: 'warning',
            message: `${here}: calls target '${call.target}' does not resolve to a known node`,
            line: call.line,
          });
        } else if (hit.kind !== call.kind) {
          diagnostics.push({
            severity: 'warning',
            message: `${here}: calls '${call.kind} ${call.target}' resolves to a ${hit.kind} (expected ${call.kind})`,
            line: call.line,
          });
        }
      }
    }

    if (node.kind === 'EventHandler' || node.kind === 'Action') {
      for (const d of node.dispatch) {
        const hit = resolve(d.target, prefix, siblings, globalIndex);
        if (!hit) {
          diagnostics.push({
            severity: 'warning',
            message: `${here}: dispatch target '${d.target}' does not resolve to a known node`,
            line: d.line,
          });
        } else if (hit.kind !== 'Event') {
          diagnostics.push({
            severity: 'warning',
            message: `${here}: dispatch target '${d.target}' resolves to a ${hit.kind} (expected Event)`,
            line: d.line,
          });
        }
      }
    }
  }
}

export function lint(ast: AST): Diagnostic[] {
  const diagnostics: Diagnostic[] = [...(ast.warnings ?? [])];
  const globalIndex = new Map<string, IndexEntry>();
  buildIndex(ast.nodes, [], globalIndex);
  lintNodes(ast.nodes, [], globalIndex, diagnostics);
  diagnostics.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return diagnostics;
}
