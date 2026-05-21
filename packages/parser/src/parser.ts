import type {
  AST, ServiceNode, DiagramNode, EntityNode, EnumNode, EventNode, EventHandlerNode,
  QueryNode, ActionNode, ActorNode, TypeNode, StateMachineNode, State, StateTransition,
  Field, FieldType, Constraint, Call, Dispatch, Tag, Diagnostic,
} from './types.js';

const KNOWN_TAGS: ReadonlySet<Tag> = new Set<Tag>(['deprecated', 'experimental']);

const PRIMITIVES = new Set(['string', 'number', 'boolean', 'Date', 'UUID', 'null']);

type Token =
  | { kind: 'ident'; value: string; line: number }
  | { kind: 'symbol'; value: string; line: number }
  | { kind: 'comment'; value: string; line: number }
  | { kind: 'eof'; line: number };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    if (src[i] === '\n') { line++; i++; continue; }
    if (/\s/.test(src[i])) { i++; continue; }
    if (src[i] === '/' && src[i + 1] === '/') {
      const startLine = line;
      i += 2;
      const start = i;
      while (i < src.length && src[i] !== '\n') i++;
      tokens.push({ kind: 'comment', value: src.slice(start, i).trim(), line: startLine });
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if ('{}[]:|?@,->'.includes(src[i])) {
      tokens.push({ kind: 'symbol', value: src[i], line });
      i++;
      continue;
    }
    // Identifiers — allow embedded '::' for qualified type references (e.g. Platform::Order)
    // and '.' for state-machine sub-references (e.g. OrderStatus.Transition)
    if (/[a-zA-Z_]/.test(src[i])) {
      const startLine = line;
      let j = i;
      while (j < src.length) {
        if (/[a-zA-Z0-9_]/.test(src[j])) {
          j++;
        } else if (
          src[j] === ':' && src[j + 1] === ':' &&
          j + 2 < src.length && /[a-zA-Z_]/.test(src[j + 2])
        ) {
          j += 2;
        } else if (
          src[j] === '.' &&
          j + 1 < src.length && /[a-zA-Z_]/.test(src[j + 1])
        ) {
          j += 1;
        } else {
          break;
        }
      }
      tokens.push({ kind: 'ident', value: src.slice(i, j), line: startLine });
      i = j;
      continue;
    }
    i++;
  }
  tokens.push({ kind: 'eof', line });
  return tokens;
}

function describeToken(t: Token): string {
  if (t.kind === 'eof') return 'end of file';
  if (t.kind === 'comment') return `comment '// ${t.value}'`;
  return `'${t.value}'`;
}

function atLine(t: Token): string {
  return ` at line ${t.line}`;
}

class Parser {
  private tokens: Token[];
  private pos = 0;
  private warnings: Diagnostic[] = [];

  constructor(src: string) {
    this.tokens = tokenize(src);
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }

  private expectIdent(value?: string): { value: string; line: number } {
    const t = this.consume();
    if (t.kind !== 'ident') throw new Error(`Expected identifier, got ${describeToken(t)}${atLine(t)}`);
    if (value && t.value !== value) throw new Error(`Expected '${value}', got '${t.value}'${atLine(t)}`);
    return { value: t.value, line: t.line };
  }

  private expectSymbol(value: string): void {
    const t = this.consume();
    if (t.kind !== 'symbol' || t.value !== value) {
      throw new Error(`Expected '${value}', got ${describeToken(t)}${atLine(t)}`);
    }
  }

  private unknownKey(nodeKind: string, allowed: readonly string[]): never {
    const t = this.peek();
    const name = t.kind === 'ident' ? `'${t.value}'` : describeToken(t);
    throw new Error(
      `Unknown property ${name} in ${nodeKind}${atLine(t)} ` +
      `(expected one of: ${allowed.join(', ')})`,
    );
  }

  private peekIs(kind: 'ident' | 'symbol', value?: string): boolean {
    const t = this.peek();
    if (t.kind !== kind) return false;
    if (value !== undefined && t.kind === kind && (t as { value: string }).value !== value) return false;
    return true;
  }

  private consumeLeadingComment(): string | undefined {
    const lines: string[] = [];
    while (this.peek().kind === 'comment') {
      const t = this.consume();
      if (t.kind === 'comment') lines.push(t.value);
    }
    return lines.length > 0 ? lines.join('\n') : undefined;
  }

  parse(): AST {
    const nodes: DiagramNode[] = [];
    while (this.peek().kind !== 'eof') {
      if (this.peek().kind === 'comment') { this.consume(); continue; }
      nodes.push(this.parseNode());
    }
    return { nodes, warnings: this.warnings.length > 0 ? this.warnings : undefined };
  }

  private parseService(external = false, declLine?: number, isInterface = false): ServiceNode {
    const kw = this.expectIdent('Service');
    const line = declLine ?? kw.line;
    const name = this.expectIdent();
    let implementsService: string | undefined;
    if (this.peekIs('ident', 'implements')) {
      this.consume();
      implementsService = this.expectIdent().value;
    }
    this.expectSymbol('{');
    const comment = this.consumeLeadingComment();
    const children: DiagramNode[] = [];
    const tags: Tag[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      if (this.peek().kind === 'comment') { this.consume(); continue; }
      if (this.tryParseTag(tags)) continue;
      if (this.peekIs('symbol', '@')) { this.consume(); continue; }
      children.push(this.parseNode());
    }
    this.expectSymbol('}');
    return {
      kind: 'Service',
      name: name.value,
      external,
      isInterface,
      implements: implementsService,
      children,
      tags,
      comment,
      line,
    };
  }

  private parseNode(): DiagramNode {
    const t = this.peek();
    if (t.kind !== 'ident') throw new Error(`Expected node keyword, got ${describeToken(t)}${atLine(t)}`);
    switch (t.value) {
      case 'external': {
        const ext = this.consume();
        const next = this.peek();
        if (next.kind === 'ident' && next.value === 'interface') {
          this.consume();
          return this.parseService(true, ext.line, true);
        }
        return this.parseService(true, ext.line, false);
      }
      case 'interface': {
        const isInterfaceTok = this.consume();
        return this.parseService(false, isInterfaceTok.line, true);
      }
      case 'Service': return this.parseService(false);
      case 'Entity': return this.parseEntity();
      case 'Enum': return this.parseEnum();
      case 'Event': return this.parseEvent();
      case 'EventHandler': return this.parseEventHandler();
      case 'Query': return this.parseQuery();
      case 'Action': return this.parseAction();
      case 'Actor': return this.parseActor();
      case 'Type': return this.parseType();
      case 'StateMachine': return this.parseStateMachine();
      default: throw new Error(`Unknown node type '${t.value}'${atLine(t)} (expected: Service, Entity, Enum, Event, EventHandler, Query, Action, Actor, Type, StateMachine, external, interface)`);
    }
  }

  private parseEntity(): EntityNode {
    const kw = this.expectIdent('Entity');
    const name = this.expectIdent();
    this.expectSymbol('{');
    const comment = this.consumeLeadingComment();
    const fields: Field[] = [];
    const constraints: Constraint[] = [];
    const tags: Tag[] = [];

    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;

      if (this.tryParseTag(tags)) continue;

      if (this.peekIs('symbol', '@')) {
        const at = this.consume(); // '@'
        const tag = this.expectIdent();
        this.expectSymbol(':');
        this.expectSymbol('[');
        const fieldNames: string[] = [];
        while (!this.peekIs('symbol', ']')) {
          if (this.peek().kind === 'eof') break;
          if (this.peek().kind === 'ident') fieldNames.push(this.expectIdent().value);
          else this.consume();
        }
        this.expectSymbol(']');
        if (tag.value === 'either' || tag.value === 'unique') {
          constraints.push({ kind: tag.value, fields: fieldNames, line: at.line });
        }
        continue;
      }

      const savedPos = this.pos;
      try {
        const fieldTok = this.expectIdent();
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
        fields.push({ name: fieldTok.value, type, optional, line: fieldTok.line });
      } catch {
        this.pos = savedPos;
        this.consume();
      }
    }

    this.expectSymbol('}');
    return { kind: 'Entity', name: name.value, fields, constraints, tags, comment, line: kw.line };
  }

  private parseEnum(): EnumNode {
    const kw = this.expectIdent('Enum');
    const name = this.expectIdent();
    this.expectSymbol('{');
    const comment = this.consumeLeadingComment();
    const variants: string[] = [];
    const tags: Tag[] = [];
    while (this.tryParseTag(tags)) { /* consume leading tags */ }
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      if (this.peek().kind === 'comment') { this.consume(); continue; }
      if (this.peek().kind === 'ident') {
        variants.push(this.expectIdent().value);
      } else {
        // skip commas and stray symbols
        this.consume();
      }
    }
    this.expectSymbol('}');
    return { kind: 'Enum', name: name.value, variants, tags, comment, line: kw.line };
  }

  private parseEvent(): EventNode {
    const kw = this.expectIdent('Event');
    const name = this.expectIdent();
    let payload: Field[] = [];
    const tags: Tag[] = [];
    let comment: string | undefined;
    if (this.peekIs('symbol', '{')) {
      this.expectSymbol('{');
      comment = this.consumeLeadingComment();
      while (this.tryParseTag(tags)) { /* consume leading tags */ }
      payload = this.parseFields();
      this.expectSymbol('}');
    }
    return { kind: 'Event', name: name.value, payload, tags, comment, line: kw.line };
  }

  private parseEventHandler(): EventHandlerNode {
    const kw = this.expectIdent('EventHandler');
    const name = this.expectIdent();
    this.expectSymbol('{');
    const comment = this.consumeLeadingComment();
    let payload: Field[] = [];
    const calls: Call[] = [];
    const dispatch: Dispatch[] = [];
    const tags: Tag[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      if (this.peek().kind === 'comment') { this.consume(); continue; }
      if (this.tryParseTag(tags)) continue;
      if (this.peekIs('ident', 'payload')) {
        this.consume();
        this.expectSymbol(':');
        this.expectSymbol('{');
        payload = this.parseFields();
        this.expectSymbol('}');
      } else if (this.peekIs('ident', 'calls')) {
        this.parseCallsList(calls);
      } else if (this.peekIs('ident', 'dispatch')) {
        this.parseDispatchList(dispatch);
      } else {
        this.unknownKey('EventHandler', ['payload', 'calls', 'dispatch']);
      }
    }
    this.expectSymbol('}');
    return { kind: 'EventHandler', name: name.value, payload, calls, dispatch, tags, comment, line: kw.line };
  }

  private parseQuery(): QueryNode {
    const kw = this.expectIdent('Query');
    const name = this.expectIdent();
    this.expectSymbol('{');
    const comment = this.consumeLeadingComment();
    let inputs: Field[] = [];
    let response: Field[] = [];
    const calls: Call[] = [];
    const tags: Tag[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      if (this.peek().kind === 'comment') { this.consume(); continue; }
      if (this.tryParseTag(tags)) continue;
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
      } else if (this.peekIs('ident', 'calls')) {
        this.parseCallsList(calls);
      } else {
        this.unknownKey('Query', ['inputs', 'response', 'calls']);
      }
    }
    this.expectSymbol('}');
    return { kind: 'Query', name: name.value, inputs, response, calls, tags, comment, line: kw.line };
  }

  private parseAction(): ActionNode {
    const kw = this.expectIdent('Action');
    const name = this.expectIdent();
    this.expectSymbol('{');
    const comment = this.consumeLeadingComment();
    let inputs: Field[] = [];
    let response: Field[] = [];
    const calls: Call[] = [];
    const dispatch: Dispatch[] = [];
    const tags: Tag[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      if (this.peek().kind === 'comment') { this.consume(); continue; }
      if (this.tryParseTag(tags)) continue;
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
      } else if (this.peekIs('ident', 'calls')) {
        this.parseCallsList(calls);
      } else if (this.peekIs('ident', 'dispatch')) {
        this.parseDispatchList(dispatch);
      } else {
        this.unknownKey('Action', ['inputs', 'response', 'calls', 'dispatch']);
      }
    }
    this.expectSymbol('}');
    return { kind: 'Action', name: name.value, inputs, response, calls, dispatch, tags, comment, line: kw.line };
  }

  private parseActor(): ActorNode {
    const kw = this.expectIdent('Actor');
    const name = this.expectIdent();
    let comment: string | undefined;
    const calls: Call[] = [];
    const tags: Tag[] = [];
    if (this.peekIs('symbol', '{')) {
      this.expectSymbol('{');
      comment = this.consumeLeadingComment();
      while (!this.peekIs('symbol', '}')) {
        if (this.peek().kind === 'eof') break;
        if (this.peek().kind === 'comment') { this.consume(); continue; }
        if (this.tryParseTag(tags)) continue;
        if (this.peekIs('ident', 'calls')) {
          this.parseCallsList(calls);
        } else {
          this.unknownKey('Actor', ['calls']);
        }
      }
      this.expectSymbol('}');
    }
    return { kind: 'Actor', name: name.value, calls, tags, comment, line: kw.line };
  }

  private parseType(): TypeNode {
    const kw = this.expectIdent('Type');
    const name = this.expectIdent();
    const tags: Tag[] = [];
    while (this.tryParseTag(tags)) { /* consume leading tags */ }
    let fields: Field[] = [];
    let comment: string | undefined;
    if (this.peekIs('symbol', '{')) {
      this.expectSymbol('{');
      comment = this.consumeLeadingComment();
      while (this.tryParseTag(tags)) { /* consume body-leading tags */ }
      fields = this.parseFields();
      this.expectSymbol('}');
    }
    return { kind: 'Type', name: name.value, fields, tags, comment, line: kw.line };
  }

  private parseStateMachine(): StateMachineNode {
    const kw = this.expectIdent('StateMachine');
    const name = this.expectIdent();
    this.expectSymbol('{');
    const comment = this.consumeLeadingComment();
    const tags: Tag[] = [];
    while (this.tryParseTag(tags)) { /* consume leading tags */ }
    const states: State[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      if (this.peek().kind === 'comment') { this.consume(); continue; }
      states.push(this.parseState());
    }
    this.expectSymbol('}');
    return { kind: 'StateMachine', name: name.value, states, tags, comment, line: kw.line };
  }

  private parseState(): State {
    const stateComment = this.consumeLeadingComment();
    let initial = false;
    if (this.peekIs('symbol', '@')) {
      const saved = this.pos;
      this.consume(); // '@'
      const t = this.peek();
      if (t.kind === 'ident' && t.value === 'initial') {
        this.consume();
        initial = true;
      } else {
        this.pos = saved;
      }
    }
    const nameTok = this.expectIdent();
    this.expectSymbol('{');
    const transitions: StateTransition[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      const transComment = this.consumeLeadingComment();
      if (this.peekIs('symbol', '}')) {
        // trailing comment with no transition after it; ignore
        break;
      }
      const trig = this.expectIdent();
      this.expectSymbol('-');
      this.expectSymbol('>');
      const tgt = this.expectIdent();
      transitions.push({
        trigger: trig.value,
        target: tgt.value,
        comment: transComment,
        line: trig.line,
      });
    }
    this.expectSymbol('}');
    return {
      name: nameTok.value,
      initial,
      transitions,
      comment: stateComment,
      line: nameTok.line,
    };
  }

  /**
   * If the next tokens form a bare `@<tag>` annotation (e.g. `@deprecated`)
   * with a known tag name and no following `:` (which would mark it as a
   * constraint), consume them and push the tag to `out`. Returns true if
   * a tag was consumed. Otherwise leaves the parser position unchanged
   * and returns false.
   */
  private tryParseTag(out: Tag[]): boolean {
    if (!this.peekIs('symbol', '@')) return false;
    const saved = this.pos;
    this.consume();
    const t = this.peek();
    if (t.kind !== 'ident' || !KNOWN_TAGS.has(t.value as Tag)) {
      this.pos = saved;
      return false;
    }
    const next = this.tokens[this.pos + 1];
    if (next && next.kind === 'symbol' && next.value === ':') {
      this.pos = saved;
      return false;
    }
    this.consume();
    out.push(t.value as Tag);
    return true;
  }

  private parseDispatchList(out: Dispatch[]): void {
    this.expectIdent('dispatch');
    this.expectSymbol(':');
    this.expectSymbol('[');
    while (!this.peekIs('symbol', ']')) {
      if (this.peek().kind === 'eof') break;
      const tok = this.peek();
      if (tok.kind === 'ident' && tok.value === 'Event') {
        this.consume();
        if (this.peek().kind === 'ident') {
          const target = this.expectIdent();
          out.push({ target: target.value, line: target.line });
        }
      } else if (tok.kind === 'ident') {
        // Unprefixed entry — warn and skip
        const dropped = this.expectIdent();
        this.warnings.push({
          severity: 'warning',
          message: `dispatch entry '${dropped.value}' is missing the 'Event' prefix and will be ignored`,
          line: dropped.line,
        });
      } else {
        this.consume();
      }
    }
    this.expectSymbol(']');
  }

  private parseCallsList(out: Call[]): void {
    this.expectIdent('calls');
    this.expectSymbol(':');
    this.expectSymbol('[');
    while (!this.peekIs('symbol', ']')) {
      if (this.peek().kind === 'eof') break;
      const t = this.peek();
      if (t.kind === 'ident' && (t.value === 'Action' || t.value === 'Query')) {
        const kind = this.expectIdent();
        if (this.peek().kind === 'ident') {
          const target = this.expectIdent();
          out.push({ kind: kind.value as 'Action' | 'Query', target: target.value, line: kind.line });
        }
      } else if (t.kind === 'ident') {
        // Unprefixed call entry — warn and skip
        const dropped = this.expectIdent();
        this.warnings.push({
          severity: 'warning',
          message: `calls entry '${dropped.value}' is missing an 'Action' or 'Query' prefix and will be ignored`,
          line: dropped.line,
        });
      } else {
        this.consume();
      }
    }
    this.expectSymbol(']');
  }

  private parseFields(): Field[] {
    const fields: Field[] = [];
    while (!this.peekIs('symbol', '}')) {
      if (this.peek().kind === 'eof') break;
      const nameToken = this.peek();
      if (nameToken.kind !== 'ident') { this.consume(); continue; }

      const savedPos = this.pos;
      try {
        const fieldTok = this.expectIdent();
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
        fields.push({ name: fieldTok.value, type, optional, line: fieldTok.line });
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
      if (next.value === 'null') nullable = true;
      while (this.peekIs('symbol', '|')) {
        this.consume();
        this.consume();
      }
    }

    return { base: base.value, nullable, array };
  }
}

export function parse(src: string): AST {
  return new Parser(src).parse();
}

const PRIMITIVES_SET = PRIMITIVES;

export function isReference(type: FieldType): boolean {
  return !PRIMITIVES_SET.has(type.base);
}
