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

function serializeComment(comment: string | undefined, indent: string): string {
  if (!comment) return '';
  return comment.split('\n').map(line => `${indent}// ${line}`).join('\n') + '\n';
}

function serializeNode(node: DiagramNode, indent: string): string {
  const i2 = indent + '  ';
  switch (node.kind) {
    case 'Service': {
      const prefix = node.external ? `${indent}external ` : `${indent}`;
      const commentStr = serializeComment(node.comment, i2);
      const children = node.children.map(n => serializeNode(n, i2)).join('\n\n');
      return `${prefix}Service ${node.name} {\n${commentStr}${children}\n${indent}}`;
    }
    case 'Entity': {
      const commentStr = serializeComment(node.comment, i2);
      const fields = node.fields.map(f => serializeField(f, i2)).join('\n');
      const constraints = node.constraints.map(c => `${i2}@${c.kind}: [${c.fields.join(', ')}]`).join('\n');
      const body = [fields, constraints].filter(Boolean).join('\n');
      return `${indent}Entity ${node.name} {\n${commentStr}${body}\n${indent}}`;
    }
    case 'Event': {
      if (node.payload.length === 0 && !node.comment) return `${indent}Event ${node.name}`;
      const commentStr = serializeComment(node.comment, i2);
      const fields = node.payload.map(f => serializeField(f, i2)).join('\n');
      return `${indent}Event ${node.name} {\n${commentStr}${fields}\n${indent}}`;
    }
    case 'EventHandler': {
      const commentStr = serializeComment(node.comment, i2);
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
      return `${indent}EventHandler ${node.name} {\n${commentStr}${parts.join('\n')}\n${indent}}`;
    }
    case 'Query': {
      const commentStr = serializeComment(node.comment, i2);
      const inputs = node.inputs.map(f => serializeField(f, i2 + '  ')).join('\n');
      const response = node.response.map(f => serializeField(f, i2 + '  ')).join('\n');
      return (
        `${indent}Query ${node.name} {\n` +
        `${commentStr}` +
        `${i2}inputs: {\n${inputs}\n${i2}}\n` +
        `${i2}response: {\n${response}\n${i2}}\n` +
        `${indent}}`
      );
    }
    case 'Action': {
      const commentStr = serializeComment(node.comment, i2);
      const parts: string[] = [];
      if (node.inputs.length > 0) {
        const inputs = node.inputs.map(f => serializeField(f, i2 + '  ')).join('\n');
        parts.push(`${i2}inputs: {\n${inputs}\n${i2}}`);
      }
      if (node.calls.length > 0) {
        const entries = node.calls.map(c => `${i2}  ${c}`).join('\n');
        parts.push(`${i2}calls: [\n${entries}\n${i2}]`);
      }
      return `${indent}Action ${node.name} {\n${commentStr}${parts.join('\n')}\n${indent}}`;
    }
    case 'Actor': {
      if (!node.comment) return `${indent}Actor ${node.name}`;
      const commentStr = serializeComment(node.comment, i2);
      return `${indent}Actor ${node.name} {\n${commentStr}${indent}}`;
    }
  }
}

export function serialize(ast: AST): string {
  return ast.nodes.map(n => serializeNode(n, '')).join('\n\n');
}
