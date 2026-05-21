import type { AST, DiagramNode, Field, FieldType, Tag, ViewNode } from './types.js';

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

function serializeTags(tags: Tag[], indent: string): string {
  if (tags.length === 0) return '';
  return tags.map(t => `${indent}@${t}`).join('\n') + '\n';
}

function serializeNode(node: DiagramNode, indent: string): string {
  const i2 = indent + '  ';
  switch (node.kind) {
    case 'Service': {
      const decl = node.isInterface ? 'interface Service' : 'Service';
      const impl = node.implements ? ` implements ${node.implements}` : '';
      const prefix = node.external ? `${indent}external ` : `${indent}`;
      const commentStr = serializeComment(node.comment, i2);
      const tagsStr = serializeTags(node.tags, i2);
      const children = node.children.map(n => serializeNode(n, i2)).join('\n\n');
      return `${prefix}${decl} ${node.name}${impl} {\n${commentStr}${tagsStr}${children}\n${indent}}`;
    }
    case 'Entity': {
      const commentStr = serializeComment(node.comment, i2);
      const tagsStr = serializeTags(node.tags, i2);
      const fields = node.fields.map(f => serializeField(f, i2)).join('\n');
      const constraints = node.constraints.map(c => `${i2}@${c.kind}: [${c.fields.join(', ')}]`).join('\n');
      const body = [fields, constraints].filter(Boolean).join('\n');
      return `${indent}Entity ${node.name} {\n${commentStr}${tagsStr}${body}\n${indent}}`;
    }
    case 'Enum': {
      const commentStr = serializeComment(node.comment, i2);
      const tagsStr = serializeTags(node.tags, i2);
      const variants = node.variants.map(v => `${i2}${v}`).join('\n');
      const body = variants ? `${variants}\n` : '';
      return `${indent}Enum ${node.name} {\n${commentStr}${tagsStr}${body}${indent}}`;
    }
    case 'Event': {
      if (node.payload.length === 0 && !node.comment && node.tags.length === 0) return `${indent}Event ${node.name}`;
      const commentStr = serializeComment(node.comment, i2);
      const tagsStr = serializeTags(node.tags, i2);
      const fields = node.payload.map(f => serializeField(f, i2)).join('\n');
      const body = fields ? `${fields}\n` : '';
      return `${indent}Event ${node.name} {\n${commentStr}${tagsStr}${body}${indent}}`;
    }
    case 'EventHandler': {
      const commentStr = serializeComment(node.comment, i2);
      const tagsStr = serializeTags(node.tags, i2);
      const parts: string[] = [];
      if (node.payload.length > 0) {
        const fields = node.payload.map(f => serializeField(f, i2 + '  ')).join('\n');
        parts.push(`${i2}payload: {\n${fields}\n${i2}}`);
      }
      if (node.calls.length > 0) {
        const entries = node.calls.map(c => `${i2}  ${c.kind} ${c.target}`).join('\n');
        parts.push(`${i2}calls: [\n${entries}\n${i2}]`);
      }
      if (node.dispatch.length > 0) {
        const dispatches = node.dispatch.map(e => `${i2}  Event ${e.target}`).join('\n');
        parts.push(`${i2}dispatch: [\n${dispatches}\n${i2}]`);
      }
      return `${indent}EventHandler ${node.name} {\n${commentStr}${tagsStr}${parts.join('\n')}\n${indent}}`;
    }
    case 'Query': {
      const commentStr = serializeComment(node.comment, i2);
      const tagsStr = serializeTags(node.tags, i2);
      const parts: string[] = [];
      if (node.inputs.length > 0) {
        const inputs = node.inputs.map(f => serializeField(f, i2 + '  ')).join('\n');
        parts.push(`${i2}inputs: {\n${inputs}\n${i2}}`);
      }
      if (node.response.length > 0) {
        const response = node.response.map(f => serializeField(f, i2 + '  ')).join('\n');
        parts.push(`${i2}response: {\n${response}\n${i2}}`);
      }
      if (node.calls.length > 0) {
        const entries = node.calls.map(c => `${i2}  ${c.kind} ${c.target}`).join('\n');
        parts.push(`${i2}calls: [\n${entries}\n${i2}]`);
      }
      return `${indent}Query ${node.name} {\n${commentStr}${tagsStr}${parts.join('\n')}\n${indent}}`;
    }
    case 'Action': {
      const commentStr = serializeComment(node.comment, i2);
      const tagsStr = serializeTags(node.tags, i2);
      const parts: string[] = [];
      if (node.inputs.length > 0) {
        const inputs = node.inputs.map(f => serializeField(f, i2 + '  ')).join('\n');
        parts.push(`${i2}inputs: {\n${inputs}\n${i2}}`);
      }
      if (node.response.length > 0) {
        const response = node.response.map(f => serializeField(f, i2 + '  ')).join('\n');
        parts.push(`${i2}response: {\n${response}\n${i2}}`);
      }
      if (node.calls.length > 0) {
        const entries = node.calls.map(c => `${i2}  ${c.kind} ${c.target}`).join('\n');
        parts.push(`${i2}calls: [\n${entries}\n${i2}]`);
      }
      if (node.dispatch.length > 0) {
        const dispatches = node.dispatch.map(e => `${i2}  Event ${e.target}`).join('\n');
        parts.push(`${i2}dispatch: [\n${dispatches}\n${i2}]`);
      }
      return `${indent}Action ${node.name} {\n${commentStr}${tagsStr}${parts.join('\n')}\n${indent}}`;
    }
    case 'Type': {
      if (node.fields.length === 0 && !node.comment) {
        const inlineTags = node.tags.length > 0 ? ' ' + node.tags.map(t => `@${t}`).join(' ') : '';
        return `${indent}Type ${node.name}${inlineTags}`;
      }
      const commentStr = serializeComment(node.comment, i2);
      const tagsStr = serializeTags(node.tags, i2);
      const fields = node.fields.map(f => serializeField(f, i2)).join('\n');
      const body = fields ? `${fields}\n` : '';
      return `${indent}Type ${node.name} {\n${commentStr}${tagsStr}${body}${indent}}`;
    }
    case 'StateMachine': {
      const commentStr = serializeComment(node.comment, i2);
      const tagsStr = serializeTags(node.tags, i2);
      const states = node.states.map(s => {
        const stateCommentStr = serializeComment(s.comment, i2);
        const initial = s.initial ? '@initial ' : '';
        if (s.transitions.length === 0) {
          return `${stateCommentStr}${i2}${initial}${s.name} {}`;
        }
        const transitions = s.transitions.map(tr => {
          const trComment = serializeComment(tr.comment, i2 + '  ');
          return `${trComment}${i2}  ${tr.trigger} -> ${tr.target}`;
        }).join('\n');
        return `${stateCommentStr}${i2}${initial}${s.name} {\n${transitions}\n${i2}}`;
      }).join('\n');
      const body = states ? `${states}\n` : '';
      return `${indent}StateMachine ${node.name} {\n${commentStr}${tagsStr}${body}${indent}}`;
    }
    case 'Actor': {
      if (!node.comment && node.calls.length === 0 && node.tags.length === 0) return `${indent}Actor ${node.name}`;
      const commentStr = serializeComment(node.comment, i2);
      const tagsStr = serializeTags(node.tags, i2);
      const parts: string[] = [];
      if (node.calls.length > 0) {
        const entries = node.calls.map(c => `${i2}  ${c.kind} ${c.target}`).join('\n');
        parts.push(`${i2}calls: [\n${entries}\n${i2}]`);
      }
      const body = parts.length > 0 ? parts.join('\n') + '\n' : '';
      return `${indent}Actor ${node.name} {\n${commentStr}${tagsStr}${body}${indent}}`;
    }
  }
}

function serializeView(view: ViewNode): string {
  const commentStr = serializeComment(view.comment, '  ');
  const entries = view.include.map(e => `    ${e.name}${e.recursive ? '.*' : ''}`).join('\n');
  const body = entries ? `  include: [\n${entries}\n  ]\n` : '';
  return `View ${view.name} {\n${commentStr}${body}}`;
}

export function serialize(ast: AST): string {
  const nodes = ast.nodes.map(n => serializeNode(n, ''));
  const views = (ast.views ?? []).map(serializeView);
  return [...nodes, ...views].join('\n\n');
}
