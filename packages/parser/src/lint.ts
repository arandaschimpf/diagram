import type { AST, DiagramNode, Diagnostic } from './types.js';
import { isReference } from './parser.js';
import { resolveInheritance } from './inheritance.js';
import { lintViews } from './views.js';

type NodeKind = DiagramNode['kind'];

type IndexEntry = {
  qualified: string;
  kind: NodeKind;
  isInterface?: boolean;
};

function isBodylessType(node: DiagramNode): boolean {
  return node.kind === 'Type' && node.fields.length === 0;
}

function buildIndex(nodes: DiagramNode[], prefix: string[], index: Map<string, IndexEntry>): void {
  for (const node of nodes) {
    if (node.kind === 'Service') {
      const qualified = [...prefix, node.name].join('::');
      index.set(qualified, { qualified, kind: node.kind, isInterface: node.isInterface });
      buildIndex(node.children, [...prefix, node.name], index);
    } else if (!isBodylessType(node)) {
      const qualified = [...prefix, node.name].join('::');
      index.set(qualified, { qualified, kind: node.kind });
    }
  }
}

function collectBodylessTypes(nodes: DiagramNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === 'Service') collectBodylessTypes(node.children, out);
    else if (isBodylessType(node)) out.add(node.name);
  }
}

function siblingsAt(nodes: DiagramNode[], prefix: string[]): Map<string, IndexEntry> {
  const siblings = new Map<string, IndexEntry>();
  for (const node of nodes) {
    if (node.kind === 'Service' || isBodylessType(node)) continue;
    const qualified = [...prefix, node.name].join('::');
    siblings.set(node.name, { qualified, kind: node.kind });
  }
  return siblings;
}

function splitDotted(name: string): { base: string; suffix?: string } {
  const dot = name.indexOf('.');
  if (dot < 0) return { base: name };
  return { base: name.slice(0, dot), suffix: name.slice(dot + 1) };
}

function resolve(
  name: string,
  prefix: string[],
  siblings: Map<string, IndexEntry>,
  globalIndex: Map<string, IndexEntry>,
): IndexEntry | undefined {
  const { base } = splitDotted(name);
  const sibling = siblings.get(base);
  if (sibling) return sibling;
  for (let i = prefix.length; i >= 0; i--) {
    const hit = globalIndex.get([...prefix.slice(0, i), base].join('::'));
    if (hit) return hit;
  }
  return undefined;
}

function lintNodes(
  nodes: DiagramNode[],
  prefix: string[],
  globalIndex: Map<string, IndexEntry>,
  userPrimitives: Set<string>,
  diagnostics: Diagnostic[],
): void {
  const siblings = siblingsAt(nodes, prefix);

  const seenNames = new Map<string, NodeKind>();
  for (const node of nodes) {
    if (node.kind === 'Service' || isBodylessType(node)) continue;
    const prior = seenNames.get(node.name);
    if (prior !== undefined) {
      const qualified = [...prefix, node.name].join('::');
      diagnostics.push({
        severity: 'error',
        message: `${node.kind} ${qualified}: duplicate name — already declared as ${prior} in the same scope`,
        line: node.line,
      });
    } else {
      seenNames.set(node.name, node.kind);
    }
  }

  for (const node of nodes) {
    if (node.kind === 'Service') {
      const here = `Service ${[...prefix, node.name].join('::')}`;
      if (node.implements) {
        const hit = resolve(node.implements, prefix, siblings, globalIndex);
        if (!hit) {
          diagnostics.push({
            severity: 'warning',
            message: `${here}: implements unknown service '${node.implements}'`,
            line: node.line,
          });
        } else if (hit.kind !== 'Service') {
          diagnostics.push({
            severity: 'error',
            message: `${here}: implements '${node.implements}' which is a ${hit.kind}, not a Service`,
            line: node.line,
          });
        } else if (!hit.isInterface) {
          diagnostics.push({
            severity: 'warning',
            message: `${here}: implements '${node.implements}' which is not defined as an interface Service`,
            line: node.line,
          });
        }
      }
      lintNodes(node.children, [...prefix, node.name], globalIndex, userPrimitives, diagnostics);
      continue;
    }
    if (isBodylessType(node)) continue;

    const here = `${node.kind} ${[...prefix, node.name].join('::')}`;

    if (node.kind === 'Entity' || node.kind === 'Type') {
      const fieldNames = new Set(node.fields.map(f => f.name));
      for (const field of node.fields) {
        if (!isReference(field.type)) continue;
        if (userPrimitives.has(field.type.base)) continue;
        const { base, suffix } = splitDotted(field.type.base);
        if (userPrimitives.has(base)) continue;
        const hit = resolve(field.type.base, prefix, siblings, globalIndex);
        if (!hit) {
          diagnostics.push({
            severity: 'warning',
            message: `${here}: field '${field.name}' references unknown type '${field.type.base}'`,
            line: field.line,
          });
        } else if (suffix !== undefined) {
          if (hit.kind !== 'StateMachine') {
            diagnostics.push({
              severity: 'error',
              message: `${here}: field '${field.name}' uses '.${suffix}' on type '${base}' which is a ${hit.kind}, not a StateMachine`,
              line: field.line,
            });
          } else if (suffix !== 'Transition') {
            diagnostics.push({
              severity: 'error',
              message: `${here}: field '${field.name}' has unknown sub-reference '.${suffix}' on StateMachine '${base}' (only '.Transition' is supported)`,
              line: field.line,
            });
          }
        }
      }
      if (node.kind === 'Entity') {
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

    if (node.kind === 'StateMachine') {
      const stateNames = new Set(node.states.map(s => s.name));
      const initialCount = node.states.filter(s => s.initial).length;
      if (initialCount === 0) {
        diagnostics.push({
          severity: 'error',
          message: `${here}: requires exactly one state marked '@initial' (found none)`,
          line: node.line,
        });
      } else if (initialCount > 1) {
        diagnostics.push({
          severity: 'error',
          message: `${here}: requires exactly one state marked '@initial' (found ${initialCount})`,
          line: node.line,
        });
      }
      for (const state of node.states) {
        const seenTriggers = new Set<string>();
        for (const tr of state.transitions) {
          if (!stateNames.has(tr.target)) {
            diagnostics.push({
              severity: 'error',
              message: `${here}: transition '${tr.trigger} -> ${tr.target}' in state '${state.name}' targets undeclared state '${tr.target}'`,
              line: tr.line,
            });
          }
          if (tr.target === state.name) {
            diagnostics.push({
              severity: 'error',
              message: `${here}: self-loop in state '${state.name}' (trigger '${tr.trigger}' targets the same state)`,
              line: tr.line,
            });
          }
          if (seenTriggers.has(tr.trigger)) {
            diagnostics.push({
              severity: 'error',
              message: `${here}: trigger '${tr.trigger}' appears more than once in state '${state.name}' (non-deterministic)`,
              line: tr.line,
            });
          }
          seenTriggers.add(tr.trigger);
        }
      }
      // Unreachable-state warning via BFS from the initial state.
      const initial = node.states.find(s => s.initial);
      if (initial) {
        const reachable = new Set<string>([initial.name]);
        const queue: string[] = [initial.name];
        const byName = new Map(node.states.map(s => [s.name, s] as const));
        while (queue.length > 0) {
          const cur = queue.shift()!;
          const s = byName.get(cur);
          if (!s) continue;
          for (const tr of s.transitions) {
            if (!reachable.has(tr.target) && byName.has(tr.target)) {
              reachable.add(tr.target);
              queue.push(tr.target);
            }
          }
        }
        for (const s of node.states) {
          if (!reachable.has(s.name)) {
            diagnostics.push({
              severity: 'warning',
              message: `${here}: state '${s.name}' is unreachable from '@initial ${initial.name}'`,
              line: s.line,
            });
          }
        }
      }
    }
  }
}

export function lint(ast: AST): Diagnostic[] {
  const inheritedAst = resolveInheritance(ast);
  const diagnostics: Diagnostic[] = [...(inheritedAst.warnings ?? [])];
  const globalIndex = new Map<string, IndexEntry>();
  buildIndex(inheritedAst.nodes, [], globalIndex);
  const userPrimitives = new Set<string>();
  collectBodylessTypes(inheritedAst.nodes, userPrimitives);
  lintNodes(inheritedAst.nodes, [], globalIndex, userPrimitives, diagnostics);
  diagnostics.push(...lintViews(inheritedAst));
  diagnostics.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return diagnostics;
}
