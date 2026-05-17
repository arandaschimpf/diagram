import type { AST, DiagramNode } from './types.js';

export type Rename = {
  oldId: string;
  newId: string;
  isService: boolean;
};

export type Layout = Record<string, { x: number; y: number; width?: number; height?: number }>;

const SERVICE_PREFIX = 'service::';

export function diffRenames(oldAst: AST, newAst: AST): Rename[] {
  const renames: Rename[] = [];
  walkLevel(oldAst.nodes, newAst.nodes, [], [], renames);
  return renames;
}

function walkLevel(
  oldChildren: DiagramNode[],
  newChildren: DiagramNode[],
  oldPath: string[],
  newPath: string[],
  renames: Rename[],
): void {
  const kinds = new Set<DiagramNode['kind']>();
  for (const n of oldChildren) kinds.add(n.kind);
  for (const n of newChildren) kinds.add(n.kind);

  const serviceRenamedMap = new Map<string, string>();

  for (const kind of kinds) {
    const oldList = oldChildren.filter(n => n.kind === kind);
    const newList = newChildren.filter(n => n.kind === kind);
    const oldNames = new Set(oldList.map(n => n.name));
    const newNames = new Set(newList.map(n => n.name));

    const disappeared = oldList.filter(n => !newNames.has(n.name));
    const appeared = newList.filter(n => !oldNames.has(n.name));

    const pairCount = Math.min(disappeared.length, appeared.length);
    for (let i = 0; i < pairCount; i++) {
      const oldName = disappeared[i].name;
      const newName = appeared[i].name;
      const oldId = [...oldPath, oldName].join('::');
      const newId = [...newPath, newName].join('::');
      renames.push({ oldId, newId, isService: kind === 'Service' });
      if (kind === 'Service') serviceRenamedMap.set(oldName, newName);
    }
  }

  const oldServices = oldChildren.filter(n => n.kind === 'Service');
  const newServicesByName = new Map<string, DiagramNode>();
  for (const n of newChildren) {
    if (n.kind === 'Service') newServicesByName.set(n.name, n);
  }

  for (const oldSvc of oldServices) {
    if (oldSvc.kind !== 'Service') continue;
    const mappedName = serviceRenamedMap.get(oldSvc.name) ?? oldSvc.name;
    const newSvc = newServicesByName.get(mappedName);
    if (!newSvc || newSvc.kind !== 'Service') continue;
    walkLevel(
      oldSvc.children,
      newSvc.children,
      [...oldPath, oldSvc.name],
      [...newPath, mappedName],
      renames,
    );
  }
}

export function migrateLayout(layout: Layout, renames: Rename[]): Layout | null {
  if (renames.length === 0) return null;

  const exact = new Map<string, string>();
  const serviceRenames: Rename[] = [];
  for (const r of renames) {
    exact.set(r.oldId, r.newId);
    if (r.isService) serviceRenames.push(r);
  }
  // Longest oldId first so nested service renames win over their ancestors.
  serviceRenames.sort((a, b) => b.oldId.length - a.oldId.length);

  const result: Layout = {};
  let changed = false;

  for (const key of Object.keys(layout)) {
    const value = layout[key];
    const isServiceKey = key.startsWith(SERVICE_PREFIX);
    const underlying = isServiceKey ? key.slice(SERVICE_PREFIX.length) : key;

    let newUnderlying: string | null = null;
    const exactHit = exact.get(underlying);
    if (exactHit !== undefined) {
      newUnderlying = exactHit;
    } else {
      for (const sr of serviceRenames) {
        const prefix = sr.oldId + '::';
        if (underlying.startsWith(prefix)) {
          newUnderlying = sr.newId + '::' + underlying.slice(prefix.length);
          break;
        }
      }
    }

    if (newUnderlying !== null && newUnderlying !== underlying) {
      const newKey = isServiceKey ? SERVICE_PREFIX + newUnderlying : newUnderlying;
      result[newKey] = value;
      changed = true;
    } else {
      result[key] = value;
    }
  }

  return changed ? result : null;
}
