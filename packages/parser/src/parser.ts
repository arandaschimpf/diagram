import type {
  AST, ServiceNode, DiagramNode, EntityNode, EventNode, EventHandlerNode,
  QueryNode, ActionNode, XORNode, ActorNode, Field, FieldType,
} from './types.js';

const PRIMITIVES = new Set(['string', 'number', 'boolean', 'Date', 'null']);

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'symbol'; value: string }
  | { kind: 'eof' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if ('{}[]:|?'.includes(src[i])) {
      tokens.push({ kind: 'symbol', value: src[i] });
      i++;
      continue;
    }
    // Identifiers — allow embedded '::' for qualified type references (e.g. Platform::Order)
    if (/[a-zA-Z_]/.test(src[i])) {
      let j = i;
      while (j < src.length) {
        if (/[a-zA-Z0-9_]/.test(src[j])) {
          j++;
        } else if (
          src[j] === ':' && src[j + 1] === ':' &&
          j + 2 < src.length && /[a-zA-Z_]/.test(src[j + 2])
        ) {
          j += 2;
        } else {
          break;
        }
      }
      tokens.push({ kind: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    i++;
  }
  tokens.push({ kind: 'eof' });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(src: string) {
    this.tokens = tokenize(src);
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }

  private expectIdent(value?: string): string {
    const t = this.consume();
    if (t.kind !== 'ident') throw new Error(`Expected identifier, got ${JSON.stringify(t)}`);
    if (value && t.value !== value) throw new Error(`Expected '${value}', got '${t.value}'`);
    return t.value;
  }

  private expectSymbol(value: string): void {
    const t = this.consume();
    if (t.kind !== 'symbol' || t.value !== value) {
      throw new Error(`Expected '${value}', got ${JSON.stringify(t)}`);
    }
  }

  private peekIs(kind: 'ident' | 'symbol', value?: string): boolean {
    const t = this.peek();
    if (t.kind !== kind) return false;
    if (value !== undefined && t.kind === kind && (t as { value: string }).value !== value) return false;
    return true;
  }

  parse(): AST {
    const nodes: DiagramNode[] = [];
    while (this.peek().kind !== 'eof') {
      nodes.push(this.parseNode());
    }
    return { nodes };
  }

  private parseService(external = false): ServiceNode {
    this.expectIdent('Service');
    const name = this.expectIdent();
    this.expectSymbol('{');
    const children: DiagramNode[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      children.push(this.parseNode());
    }
    this.expectSymbol('}');
    return { kind: 'Service', name, external, children };
  }

  private parseNode(): DiagramNode {
    const t = this.peek();
    if (t.kind !== 'ident') throw new Error(`Expected node keyword, got ${JSON.stringify(t)}`);
    switch (t.value) {
      case 'external': {
        this.consume();
        return this.parseService(true);
      }
      case 'Service': return this.parseService(false);
      case 'Entity': return this.parseEntity();
      case 'Event': return this.parseEvent();
      case 'EventHandler': return this.parseEventHandler();
      case 'Query': return this.parseQuery();
      case 'Action': return this.parseAction();
      case 'XOR': return this.parseXOR();
      case 'Actor': return this.parseActor();
      default: throw new Error(`Unknown node type: ${t.value}`);
    }
  }

  private parseEntity(): EntityNode {
    this.expectIdent('Entity');
    const name = this.expectIdent();
    this.expectSymbol('{');
    const fields = this.parseFields();
    this.expectSymbol('}');
    return { kind: 'Entity', name, fields };
  }

  private parseEvent(): EventNode {
    this.expectIdent('Event');
    const name = this.expectIdent();
    let payload: Field[] = [];
    if (this.peekIs('symbol', '{')) {
      this.expectSymbol('{');
      payload = this.parseFields();
      this.expectSymbol('}');
    }
    return { kind: 'Event', name, payload };
  }

  private parseEventHandler(): EventHandlerNode {
    this.expectIdent('EventHandler');
    const name = this.expectIdent();
    this.expectSymbol('{');
    let payload: Field[] = [];
    const calls: string[] = [];
    const dispatch: string[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      if (this.peekIs('ident', 'payload')) {
        this.consume();
        this.expectSymbol(':');
        this.expectSymbol('{');
        payload = this.parseFields();
        this.expectSymbol('}');
      } else if (this.peekIs('ident', 'calls')) {
        this.consume();
        this.expectSymbol(':');
        this.expectSymbol('[');
        while (!this.peekIs('symbol', ']')) {
          if (this.peek().kind === 'eof') break;
          if (this.peek().kind === 'ident') calls.push(this.expectIdent());
          else this.consume();
        }
        this.expectSymbol(']');
      } else if (this.peekIs('ident', 'dispatch')) {
        this.expectIdent('dispatch');
        this.expectSymbol(':');
        this.expectSymbol('[');
        while (!this.peekIs('symbol', ']')) {
          if (this.peek().kind === 'eof') break;
          if (this.peekIs('ident', 'Event')) this.consume();
          if (this.peek().kind === 'ident') dispatch.push(this.expectIdent());
        }
        this.expectSymbol(']');
      } else {
        this.consume();
      }
    }
    this.expectSymbol('}');
    return { kind: 'EventHandler', name, payload, calls, dispatch };
  }

  private parseQuery(): QueryNode {
    this.expectIdent('Query');
    const name = this.expectIdent();
    this.expectSymbol('{');
    let inputs: Field[] = [];
    let response: Field[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      if (this.peekIs('ident', 'inputs')) {
        this.consume();
        this.expectSymbol(':');
        this.expectSymbol('{');
        inputs = this.parseFields();
        this.expectSymbol('}');
      } else if (this.peekIs('ident', 'response')) {
        this.consume();
        this.expectSymbol(':');
        this.expectSymbol('{');
        response = this.parseFields();
        this.expectSymbol('}');
      } else {
        this.consume();
      }
    }
    this.expectSymbol('}');
    return { kind: 'Query', name, inputs, response };
  }

  private parseAction(): ActionNode {
    this.expectIdent('Action');
    const name = this.expectIdent();
    this.expectSymbol('{');
    let inputs: Field[] = [];
    const calls: string[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      if (this.peekIs('ident', 'inputs')) {
        this.consume();
        this.expectSymbol(':');
        this.expectSymbol('{');
        inputs = this.parseFields();
        this.expectSymbol('}');
      } else if (this.peekIs('ident', 'calls')) {
        this.consume();
        this.expectSymbol(':');
        this.expectSymbol('[');
        while (!this.peekIs('symbol', ']')) {
          if (this.peek().kind === 'eof') break;
          if (this.peek().kind === 'ident') calls.push(this.expectIdent());
          else this.consume();
        }
        this.expectSymbol(']');
      } else {
        this.consume();
      }
    }
    this.expectSymbol('}');
    return { kind: 'Action', name, inputs, calls };
  }

  private parseXOR(): XORNode {
    this.expectIdent('XOR');
    const name = this.expectIdent();
    this.expectSymbol('{');
    const options: string[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      if (this.peekIs('ident', 'options')) {
        this.consume();
        this.expectSymbol(':');
        this.expectSymbol('[');
        while (!this.peekIs('symbol', ']')) {
          if (this.peek().kind === 'eof') break;
          if (this.peek().kind === 'ident') options.push(this.expectIdent());
          else this.consume();
        }
        this.expectSymbol(']');
      } else {
        this.consume();
      }
    }
    this.expectSymbol('}');
    return { kind: 'XOR', name, options };
  }

  private parseActor(): ActorNode {
    this.expectIdent('Actor');
    const name = this.expectIdent();
    return { kind: 'Actor', name };
  }

  private parseFields(): Field[] {
    const fields: Field[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      const nameToken = this.peek();
      if (nameToken.kind !== 'ident') { this.consume(); continue; }

      const savedPos = this.pos;
      try {
        const fieldName = this.expectIdent();
        let optional = false;
        if (this.peekIs('symbol', '?')) {
          this.consume();
          optional = true;
        }
        if (!this.peekIs('symbol', ':')) {
          this.pos = savedPos;
          this.consume();
          continue;
        }
        this.expectSymbol(':');
        const type = this.parseFieldType();
        fields.push({ name: fieldName, type, optional });
      } catch {
        this.pos = savedPos;
        this.consume();
      }
    }
    return fields;
  }

  private parseFieldType(): FieldType {
    const base = this.expectIdent();
    let array = false;
    let nullable = false;

    if (this.peekIs('symbol', '[')) {
      this.consume();
      this.expectSymbol(']');
      array = true;
    }

    if (this.peekIs('symbol', '|')) {
      this.consume();
      const next = this.expectIdent();
      if (next === 'null') nullable = true;
      while (this.peekIs('symbol', '|')) {
        this.consume();
        this.consume();
      }
    }

    return { base, nullable, array };
  }
}

export function parse(src: string): AST {
  return new Parser(src).parse();
}

const PRIMITIVES_SET = PRIMITIVES;

export function isReference(type: FieldType): boolean {
  return !PRIMITIVES_SET.has(type.base);
}
