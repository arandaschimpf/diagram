import { parse, serialize } from '@diagram/parser';
import type { AST, DiagramNode } from '@diagram/parser';

export type TargetKind = 'Action' | 'Query' | 'Event';

// ── Position-aware text scanner ──────────────────────────────────────────────

const NODE_KEYWORDS = new Set(['Service', 'Entity', 'Enum', 'Event', 'EventHandler', 'Query', 'Action', 'Actor']);

type ScannedNode = {
  kind: string;
  name: string;
  path: string[];        // qualified path including this node's name
  hasBody: boolean;
  declStart: number;     // char offset of the first char of the declaration (e.g. 'external' or keyword)
  declEnd: number;       // char offset right after the closing `}` (or after the name for bare nodes)
  lineIndent: string;    // whitespace prefix of the declaration's line
};

function scanNodes(code: string): ScannedNode[] {
  const results: ScannedNode[] = [];
  const stack: (ScannedNode & { bodyBraceDepth: number })[] = [];

  let i = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
  const isIdentCont = (c: string) => /[A-Za-z0-9_]/.test(c);

  function getLineIndent(pos: number): string {
    let s = pos;
    while (s > 0 && code[s - 1] !== '\n') s--;
    let p = s;
    while (p < pos && (code[p] === ' ' || code[p] === '\t')) p++;
    return code.slice(s, p);
  }

  function skipWs(): void {
    while (i < code.length) {
      const c = code[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (c === '/' && code[i + 1] === '/') {
        while (i < code.length && code[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && code[i + 1] === '*') {
        i += 2;
        while (i < code.length - 1 && !(code[i] === '*' && code[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      break;
    }
  }

  function readIdent(): string | null {
    if (i >= code.length || !isIdentStart(code[i])) return null;
    const start = i;
    while (i < code.length) {
      const c = code[i];
      if (isIdentCont(c)) { i++; continue; }
      if (c === ':' && code[i + 1] === ':' && i + 2 < code.length && isIdentStart(code[i + 2])) {
        i += 2; continue;
      }
      break;
    }
    return code.slice(start, i);
  }

  while (i < code.length) {
    skipWs();
    if (i >= code.length) break;
    const c = code[i];

    if (c === '[') { bracketDepth++; i++; continue; }
    if (c === ']') { bracketDepth = Math.max(0, bracketDepth - 1); i++; continue; }

    if (c === '{') {
      braceDepth++;
      const top = stack[stack.length - 1];
      if (top && top.bodyBraceDepth === -1) top.bodyBraceDepth = braceDepth;
      i++;
      continue;
    }
    if (c === '}') {
      const top = stack[stack.length - 1];
      if (top && top.bodyBraceDepth === braceDepth) {
        stack.pop();
        top.declEnd = i + 1;
        results.push(top);
      }
      braceDepth--;
      i++;
      continue;
    }

    // Inside `[...]` lists, skip everything (refs, not declarations).
    if (bracketDepth > 0) {
      if (isIdentStart(c)) { readIdent(); }
      else { i++; }
      continue;
    }

    if (c === '@') {
      // Skip `@something` or `@something: [..]` — handled by general logic.
      i++;
      continue;
    }

    if (isIdentStart(c)) {
      const declStart = i;
      const lineIndent = getLineIndent(declStart);
      let word = readIdent();
      if (word === 'external') {
        skipWs();
        word = readIdent();
      }
      if (!word || !NODE_KEYWORDS.has(word)) continue;

      const kind = word;
      skipWs();
      const name = readIdent();
      if (!name) continue;

      const parentPath = stack.map(s => s.name);
      const path = [...parentPath, name];

      const beforeBody = i;
      skipWs();
      if (code[i] === '{') {
        stack.push({
          kind, name, path,
          hasBody: true,
          declStart, declEnd: -1,
          lineIndent,
          bodyBraceDepth: -1,
        });
        // Leave `{` for the main loop to consume.
      } else {
        results.push({
          kind, name, path,
          hasBody: false,
          declStart, declEnd: beforeBody,
          lineIndent,
        });
        i = beforeBody;
      }
      continue;
    }

    i++;
  }

  return results;
}

// ── AST helpers ──────────────────────────────────────────────────────────────

function findAstNode(ast: AST, path: string[]): { node: DiagramNode; parentPath: string[] } | null {
  function walk(nodes: DiagramNode[], prefix: string[], remaining: string[]): { node: DiagramNode; parentPath: string[] } | null {
    if (remaining.length === 0) return null;
    const [head, ...rest] = remaining;
    for (const node of nodes) {
      if (node.name !== head) continue;
      if (rest.length === 0) return { node, parentPath: prefix };
      if (node.kind === 'Service') {
        const found = walk(node.children, [...prefix, node.name], rest);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(ast.nodes, [], path);
}

function buildGlobalIndex(ast: AST): Set<string> {
  const index = new Set<string>();
  function walk(nodes: DiagramNode[], prefix: string[]): void {
    for (const node of nodes) {
      const full = [...prefix, node.name];
      if (node.kind === 'Service') {
        walk(node.children, full);
      } else {
        index.add(full.join('::'));
      }
    }
  }
  walk(ast.nodes, []);
  return index;
}

function buildSiblingNames(ast: AST, parentPath: string[]): Set<string> {
  const names = new Set<string>();
  function find(nodes: DiagramNode[], remaining: string[]): DiagramNode[] | null {
    if (remaining.length === 0) return nodes;
    const [head, ...rest] = remaining;
    for (const n of nodes) {
      if (n.kind === 'Service' && n.name === head) {
        return find(n.children, rest);
      }
    }
    return null;
  }
  const siblings = find(ast.nodes, parentPath);
  if (siblings) {
    for (const n of siblings) {
      if (n.kind !== 'Service') names.add(n.name);
    }
  }
  return names;
}

/** Resolve a reference string against the scope-walking rules used by `inferEdges`. */
function resolveRef(
  ref: string,
  sourceScope: string[],
  globalIndex: Set<string>,
  siblings: Set<string>,
): string | null {
  if (siblings.has(ref)) {
    const full = [...sourceScope, ref].join('::');
    if (globalIndex.has(full)) return full;
  }
  const refParts = ref.split('::');
  for (let k = sourceScope.length; k >= 0; k--) {
    const candidate = [...sourceScope.slice(0, k), ...refParts].join('::');
    if (globalIndex.has(candidate)) return candidate;
  }
  return null;
}

/** Shortest qualifier for `targetPath` from a source whose parent scope is `sourceScope`. */
function shortestQualifier(targetPath: string[], sourceScope: string[], ast: AST): string {
  const globalIndex = buildGlobalIndex(ast);
  const siblings = buildSiblingNames(ast, sourceScope);
  const targetFull = targetPath.join('::');
  // Try shortest suffix first (just the leaf name) and grow until something resolves
  // unambiguously to the intended target.
  for (let suffixStart = targetPath.length - 1; suffixStart >= 0; suffixStart--) {
    const candidate = targetPath.slice(suffixStart).join('::');
    if (resolveRef(candidate, sourceScope, globalIndex, siblings) === targetFull) {
      return candidate;
    }
  }
  return targetFull;
}

// ── Replace a node's text by re-serializing it ───────────────────────────────

function replaceNodeText(code: string, sourceId: string, node: DiagramNode): string | null {
  const scanned = scanNodes(code).find(n => n.path.join('::') === sourceId);
  if (!scanned) return null;

  const indent = scanned.lineIndent;
  const fresh = serialize({ nodes: [node] });
  // Serializer emits with no leading indent; prepend `indent` to lines 2+
  // (line 1 already sits at the original indent position in the source).
  const lines = fresh.split('\n');
  const reindented = lines.length <= 1
    ? lines.join('\n')
    : [lines[0], ...lines.slice(1).map(l => l ? indent + l : l)].join('\n');

  return code.slice(0, scanned.declStart) + reindented + code.slice(scanned.declEnd);
}

// ── Public API ──────────────────────────────────────────────────────────────

export function addEdgeToCode(
  code: string,
  sourceId: string,
  targetId: string,
  targetKind: TargetKind,
): string {
  let ast: AST;
  try { ast = parse(code); } catch { return code; }

  const sourcePath = sourceId.split('::');
  const targetPath = targetId.split('::');

  const found = findAstNode(ast, sourcePath);
  if (!found) return code;
  const source = found.node;
  if (source.kind !== 'Action' && source.kind !== 'EventHandler' && source.kind !== 'Actor' && source.kind !== 'Query') return code;

  const ref = shortestQualifier(targetPath, found.parentPath, ast);

  if (targetKind === 'Event') {
    if (source.kind === 'Actor' || source.kind === 'Query') return code; // actors and queries don't dispatch
    if (source.dispatch.some(d => d.target === ref)) return code;
    source.dispatch.push({ target: ref });
  } else {
    if (source.calls.some(c => c.target === ref)) return code;
    source.calls.push({ kind: targetKind, target: ref });
  }

  const updated = replaceNodeText(code, sourceId, source);
  return updated ?? code;
}

export function removeEdgeFromCode(
  code: string,
  sourceId: string,
  targetId: string,
  targetKind: TargetKind,
): string {
  let ast: AST;
  try { ast = parse(code); } catch { return code; }

  const sourcePath = sourceId.split('::');
  const found = findAstNode(ast, sourcePath);
  if (!found) return code;
  const source = found.node;
  if (source.kind !== 'Action' && source.kind !== 'EventHandler' && source.kind !== 'Actor' && source.kind !== 'Query') return code;

  const globalIndex = buildGlobalIndex(ast);
  const siblings = buildSiblingNames(ast, found.parentPath);

  if (targetKind === 'Event') {
    if (source.kind === 'Actor' || source.kind === 'Query') return code;
    const idx = source.dispatch.findIndex(
      d => resolveRef(d.target, found.parentPath, globalIndex, siblings) === targetId,
    );
    if (idx === -1) return code;
    source.dispatch.splice(idx, 1);
  } else {
    const idx = source.calls.findIndex(
      c => resolveRef(c.target, found.parentPath, globalIndex, siblings) === targetId,
    );
    if (idx === -1) return code;
    source.calls.splice(idx, 1);
  }

  const updated = replaceNodeText(code, sourceId, source);
  return updated ?? code;
}
