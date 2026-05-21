export type FieldType = {
  base: string;
  nullable: boolean;
  array: boolean;
};

export type Field = {
  name: string;
  type: FieldType;
  optional: boolean;
  line?: number;
};

export type Constraint = {
  kind: 'either' | 'unique';
  fields: string[];
  line?: number;
};

export type Call = {
  kind: 'Action' | 'Query';
  target: string;
  line?: number;
};

export type Dispatch = {
  target: string;
  line?: number;
};

export type Tag = 'deprecated' | 'experimental';

export type EntityNode = {
  kind: 'Entity';
  name: string;
  fields: Field[];
  constraints: Constraint[];
  tags: Tag[];
  comment?: string;
  line?: number;
};

export type EnumNode = {
  kind: 'Enum';
  name: string;
  variants: string[];
  tags: Tag[];
  comment?: string;
  line?: number;
};

export type EventNode = {
  kind: 'Event';
  name: string;
  payload: Field[];
  tags: Tag[];
  comment?: string;
  line?: number;
};

export type EventHandlerNode = {
  kind: 'EventHandler';
  name: string;
  payload: Field[];
  calls: Call[];
  dispatch: Dispatch[];
  tags: Tag[];
  comment?: string;
  line?: number;
};

export type QueryNode = {
  kind: 'Query';
  name: string;
  inputs: Field[];
  response: Field[];
  calls: Call[];
  tags: Tag[];
  comment?: string;
  line?: number;
};

export type ActionNode = {
  kind: 'Action';
  name: string;
  inputs: Field[];
  response: Field[];
  calls: Call[];
  dispatch: Dispatch[];
  tags: Tag[];
  comment?: string;
  line?: number;
};

export type ActorNode = {
  kind: 'Actor';
  name: string;
  calls: Call[];
  tags: Tag[];
  comment?: string;
  line?: number;
};

export type TypeNode = {
  kind: 'Type';
  name: string;
  fields: Field[];
  tags: Tag[];
  comment?: string;
  line?: number;
};

export type StateTransition = {
  trigger: string;
  target: string;
  comment?: string;
  line?: number;
};

export type State = {
  name: string;
  initial: boolean;
  transitions: StateTransition[];
  comment?: string;
  line?: number;
};

export type StateMachineNode = {
  kind: 'StateMachine';
  name: string;
  states: State[];
  tags: Tag[];
  comment?: string;
  line?: number;
};

export type ServiceNode = {
  kind: 'Service';
  name: string;
  external: boolean;
  isInterface: boolean;
  implements?: string;
  children: DiagramNode[];
  tags: Tag[];
  comment?: string;
  line?: number;
};

export type DiagramNode =
  | EntityNode
  | EnumNode
  | EventNode
  | EventHandlerNode
  | QueryNode
  | ActionNode
  | ActorNode
  | TypeNode
  | ServiceNode
  | StateMachineNode;

export type ViewIncludeEntry = {
  /** Qualified name as written (e.g. "AbstractWalletService" or "Platform::Custody"). */
  name: string;
  /** True if entry was written as `Name.*` — include the named service and all its descendants. */
  recursive: boolean;
  line?: number;
};

export type ViewNode = {
  kind: 'View';
  name: string;
  include: ViewIncludeEntry[];
  comment?: string;
  line?: number;
};

export type Diagnostic = {
  severity: 'error' | 'warning';
  message: string;
  line?: number;
};

export type AST = {
  nodes: DiagramNode[];
  views?: ViewNode[];
  warnings?: Diagnostic[];
  /** Set by resolveInheritance to short-circuit redundant passes. */
  inheritanceResolved?: boolean;
};

export type Edge = {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
};
