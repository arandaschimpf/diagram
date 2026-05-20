import type { AST, Diagnostic, DiagramNode, ServiceNode } from './types.js';

export function resolveInheritance(ast: AST): AST {
  if (ast.inheritanceResolved) return ast;

  const clonedNodes = structuredClone(ast.nodes);
  const warnings: Diagnostic[] = ast.warnings ? [...ast.warnings] : [];
  const serviceMap = new Map<string, ServiceNode>();

  function indexServices(nodes: DiagramNode[], prefix: string[]) {
    for (const node of nodes) {
      if (node.kind === 'Service') {
        const qualified = [...prefix, node.name].join('::');
        serviceMap.set(qualified, node);
        indexServices(node.children, [...prefix, node.name]);
      }
    }
  }
  indexServices(clonedNodes, []);

  function resolveService(target: string, prefix: string[]): { service: ServiceNode; qualified: string } | undefined {
    for (let i = prefix.length; i >= 0; i--) {
      const qualified = [...prefix.slice(0, i), target].join('::');
      const hit = serviceMap.get(qualified);
      if (hit) return { service: hit, qualified };
    }
    return undefined;
  }

  const resolved = new Set<string>();
  const visiting = new Set<string>();

  function resolveServiceInheritance(qualifiedName: string) {
    if (resolved.has(qualifiedName)) return;
    if (visiting.has(qualifiedName)) {
      const service = serviceMap.get(qualifiedName);
      warnings.push({
        severity: 'warning',
        message: `Service ${qualifiedName}: circular 'implements' chain detected — inheritance partially applied`,
        line: service?.line,
      });
      return;
    }
    visiting.add(qualifiedName);

    const service = serviceMap.get(qualifiedName);
    if (service && service.implements) {
      const parentPrefix = qualifiedName.split('::').slice(0, -1);
      const hit = resolveService(service.implements, parentPrefix);
      if (hit) {
        resolveServiceInheritance(hit.qualified);
        const existingNames = new Set(service.children.map(c => c.name));
        for (const child of hit.service.children) {
          if (existingNames.has(child.name)) continue;
          const clonedChild = structuredClone(child);
          // Stamp the line to the implementer so diagnostics point at the implements site,
          // not at the interface's source line.
          stampLine(clonedChild, service.line);
          service.children.push(clonedChild);
        }
      }
    }

    visiting.delete(qualifiedName);
    resolved.add(qualifiedName);
  }

  for (const qualified of serviceMap.keys()) {
    resolveServiceInheritance(qualified);
  }

  return {
    ...ast,
    nodes: clonedNodes,
    warnings: warnings.length > 0 ? warnings : undefined,
    inheritanceResolved: true,
  };
}

function stampLine(node: DiagramNode, line: number | undefined): void {
  if (line === undefined) return;
  node.line = line;
}
