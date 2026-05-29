import type { AST, DiagramNode, ServiceNode } from './types.js';

// Semantic AST diff: compares an "old" AST (e.g. git HEAD) against a "new" AST
// (the working copy) and classifies every node as added / removed / modified /
// renamed / unchanged. Field-level detail is derived in the renderer by
// comparing each node against the `oldNode` carried here.
//
// Node identity mirrors the XYFlow id scheme used by `dslToFlow`:
//   - leaf nodes:    `Platform::Auth::User`
//   - service nodes: `service::Platform::Auth`
// so the frontend can look up diff info by the same id it renders with.

export type NodeStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'unchanged'
  /** A service that did not itself change but contains a change somewhere below. */
  | 'ancestor';

export type NodeDiffInfo = {
  status: NodeStatus;
  /** Present for modified / renamed / removed — the previous version of the node. */
  oldNode?: DiagramNode;
  /** Present for renamed — the previous name. */
  oldName?: string;
};

export type RemovedNodeInfo = {
  /** XYFlow id the ghost should render under (leaf id or `service::` id). */
  id: string;
  node: DiagramNode;
  /** Names of the enclosing services, outermost first. */
  parentPath: string[];
  isService: boolean;
};

export type DiagramDiff = {
  /** Keyed by current (new) XYFlow id. */
  current: Map<string, NodeDiffInfo>;
  removed: RemovedNodeInfo[];
  /** `service::` ids that contain a change somewhere in their subtree. */
  changedAncestors: Set<string>;
};

const SERVICE_PREFIX = 'service::';

function isBodyless(node: DiagramNode): boolean {
  return node.kind === 'Type' && node.fields.length === 0;
}

function leafId(path: string[], name: string): string {
  return [...path, name].join('::');
}

function serviceId(path: string[], name: string): string {
  return SERVICE_PREFIX + [...path, name].join('::');
}

/** Stable comparison that ignores source line numbers. */
function stableEqual(a: unknown, b: unknown): boolean {
  const replacer = (key: string, value: unknown) => (key === 'line' ? undefined : value);
  return JSON.stringify(a, replacer) === JSON.stringify(b, replacer);
}

/** Compare a service's own definition (not its children). */
function serviceShallowEqual(a: ServiceNode, b: ServiceNode): boolean {
  return (
    a.external === b.external &&
    a.isInterface === b.isInterface &&
    a.implements === b.implements &&
    a.comment === b.comment &&
    stableEqual(a.tags, b.tags)
  );
}

function addAncestors(path: string[], set: Set<string>): void {
  for (let i = 1; i <= path.length; i++) {
    set.add(SERVICE_PREFIX + path.slice(0, i).join('::'));
  }
}

function emitRemovedSubtree(node: DiagramNode, oldPath: string[], diff: DiagramDiff): void {
  if (node.kind === 'Service') {
    diff.removed.push({
      id: serviceId(oldPath, node.name),
      node,
      parentPath: oldPath,
      isService: true,
    });
    for (const child of node.children) {
      emitRemovedSubtree(child, [...oldPath, node.name], diff);
    }
    return;
  }
  if (isBodyless(node)) return;
  diff.removed.push({
    id: leafId(oldPath, node.name),
    node,
    parentPath: oldPath,
    isService: false,
  });
}

function emitAddedSubtree(node: DiagramNode, newPath: string[], diff: DiagramDiff): void {
  if (node.kind === 'Service') {
    diff.current.set(serviceId(newPath, node.name), { status: 'added' });
    addAncestors(newPath, diff.changedAncestors);
    for (const child of node.children) {
      emitAddedSubtree(child, [...newPath, node.name], diff);
    }
    return;
  }
  if (isBodyless(node)) return;
  diff.current.set(leafId(newPath, node.name), { status: 'added' });
  addAncestors(newPath, diff.changedAncestors);
}

function walk(
  oldNodes: DiagramNode[],
  newNodes: DiagramNode[],
  oldPath: string[],
  newPath: string[],
  diff: DiagramDiff,
): void {
  const kinds = new Set<DiagramNode['kind']>();
  for (const n of oldNodes) kinds.add(n.kind);
  for (const n of newNodes) kinds.add(n.kind);

  for (const kind of kinds) {
    const oldList = oldNodes.filter(n => n.kind === kind);
    const newList = newNodes.filter(n => n.kind === kind);
    const oldByName = new Map(oldList.map(n => [n.name, n]));
    const newNames = new Set(newList.map(n => n.name));

    // 1. Matched by name.
    for (const newNode of newList) {
      const oldNode = oldByName.get(newNode.name);
      if (!oldNode) continue;
      if (newNode.kind === 'Service' && oldNode.kind === 'Service') {
        if (!serviceShallowEqual(oldNode, newNode)) {
          diff.current.set(serviceId(newPath, newNode.name), { status: 'modified', oldNode });
          addAncestors(newPath, diff.changedAncestors);
        }
        walk(
          oldNode.children,
          newNode.children,
          [...oldPath, oldNode.name],
          [...newPath, newNode.name],
          diff,
        );
      } else if (!isBodyless(newNode)) {
        const same = stableEqual(oldNode, newNode);
        diff.current.set(leafId(newPath, newNode.name), {
          status: same ? 'unchanged' : 'modified',
          ...(same ? {} : { oldNode }),
        });
        if (!same) addAncestors(newPath, diff.changedAncestors);
      }
    }

    // 2. Leftovers: pair disappeared/appeared positionally as renames
    //    (mirrors diffRenames so layout migration and diff agree).
    const disappeared = oldList.filter(n => !newNames.has(n.name));
    const appeared = newList.filter(n => !oldByName.has(n.name));
    const pairCount = Math.min(disappeared.length, appeared.length);

    for (let i = 0; i < pairCount; i++) {
      const oldNode = disappeared[i];
      const newNode = appeared[i];
      diff.current.set(
        newNode.kind === 'Service'
          ? serviceId(newPath, newNode.name)
          : leafId(newPath, newNode.name),
        { status: 'renamed', oldNode, oldName: oldNode.name },
      );
      addAncestors(newPath, diff.changedAncestors);
      if (newNode.kind === 'Service' && oldNode.kind === 'Service') {
        walk(
          oldNode.children,
          newNode.children,
          [...oldPath, oldNode.name],
          [...newPath, newNode.name],
          diff,
        );
      }
    }

    for (let i = pairCount; i < appeared.length; i++) {
      emitAddedSubtree(appeared[i], newPath, diff);
    }
    for (let i = pairCount; i < disappeared.length; i++) {
      emitRemovedSubtree(disappeared[i], oldPath, diff);
      addAncestors(oldPath, diff.changedAncestors);
    }
  }
}

export function diffAst(oldAst: AST, newAst: AST): DiagramDiff {
  const diff: DiagramDiff = {
    current: new Map(),
    removed: [],
    changedAncestors: new Set(),
  };
  walk(oldAst.nodes, newAst.nodes, [], [], diff);
  return diff;
}
