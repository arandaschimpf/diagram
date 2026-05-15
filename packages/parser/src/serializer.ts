import type { AST, DiagramNode, Field, FieldType } from './types.js';

function serializeFieldType(type: FieldType): string {
  let s = type.base;
  if (type.array) s += '[]';
  if (type.nullable) s += ' | null';
  return s;
}

function serializeField(field: Field, indent: string): string {
  const optional = field.optional ? '?' : '';
  return `${indent}${field.name}${optional}: ${serializeFieldType(field.type)}`;
}

function serializeNode(node: DiagramNode, indent: string): string {
  const i2 = indent + '  ';
  switch (node.kind) {
    case 'Service': {
      const prefix = node.external ? `${indent}external ` : `${indent}`;
      const children = node.children.map(n => serializeNode(n, i2)).join('\n\n');
      return `${prefix}Service ${node.name} {\n${children}\n${indent}}`;
    }
    case 'Entity': {
      const fields = node.fields.map(f => serializeField(f, i2)).join('\n');
      return `${indent}Entity ${node.name} {\n${fields}\n${indent}}`;
    }
    case 'Event': {
      if (node.payload.length === 0) return `${indent}Event ${node.name}`;
      const fields = node.payload.map(f => serializeField(f, i2)).join('\n');
      return `${indent}Event ${node.name} {\n${fields}\n${indent}}`;
    }
    case 'EventHandler': {
      const parts: string[] = [];
      if (node.payload.length > 0) {
        const fields = node.payload.map(f => serializeField(f, i2 + '  ')).join('\n');
        parts.push(`${i2}payload: {\n${fields}\n${i2}}`);
      }
      if (node.calls.length > 0) {
        const entries = node.calls.map(c => `${i2}  ${c}`).join('\n');
        parts.push(`${i2}calls: [\n${entries}\n${i2}]`);
      }
      if (node.dispatch.length > 0) {
        const dispatches = node.dispatch.map(e => `${i2}  Event ${e}`).join('\n');
        parts.push(`${i2}dispatch: [\n${dispatches}\n${i2}]`);
      }
      return `${indent}EventHandler ${node.name} {\n${parts.join('\n')}\n${indent}}`;
    }
    case 'Query': {
      const inputs = node.inputs.map(f => serializeField(f, i2 + '  ')).join('\n');
      const response = node.response.map(f => serializeField(f, i2 + '  ')).join('\n');
      return (
        `${indent}Query ${node.name} {\n` +
        `${i2}inputs: {\n${inputs}\n${i2}}\n` +
        `${i2}response: {\n${response}\n${i2}}\n` +
        `${indent}}`
      );
    }
    case 'Action': {
      const parts: string[] = [];
      if (node.inputs.length > 0) {
        const inputs = node.inputs.map(f => serializeField(f, i2 + '  ')).join('\n');
        parts.push(`${i2}inputs: {\n${inputs}\n${i2}}`);
      }
      if (node.calls.length > 0) {
        const entries = node.calls.map(c => `${i2}  ${c}`).join('\n');
        parts.push(`${i2}calls: [\n${entries}\n${i2}]`);
      }
      return `${indent}Action ${node.name} {\n${parts.join('\n')}\n${indent}}`;
    }
    case 'XOR': {
      const opts = node.options.join(', ');
      return `${indent}XOR ${node.name} {\n${i2}options: [${opts}]\n${indent}}`;
    }
    case 'Actor':
      return `${indent}Actor ${node.name}`;
  }
}

export function serialize(ast: AST): string {
  return ast.nodes.map(n => serializeNode(n, '')).join('\n\n');
}
