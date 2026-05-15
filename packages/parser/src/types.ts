export type FieldType = {
  base: string;
  nullable: boolean;
  array: boolean;
};

export type Field = {
  name: string;
  type: FieldType;
  optional: boolean;
};

export type Constraint = {
  kind: 'either' | 'unique';
  fields: string[];
};

export type EntityNode = {
  kind: 'Entity';
  name: string;
  fields: Field[];
  constraints: Constraint[];
  comment?: string;
};

export type EventNode = {
  kind: 'Event';
  name: string;
  payload: Field[];
  comment?: string;
};

export type EventHandlerNode = {
  kind: 'EventHandler';
  name: string;
  payload: Field[];
  calls: string[];
  dispatch: string[];
  comment?: string;
};

export type QueryNode = {
  kind: 'Query';
  name: string;
  inputs: Field[];
  response: Field[];
  comment?: string;
};

export type ActionNode = {
  kind: 'Action';
  name: string;
  inputs: Field[];
  calls: string[];
  comment?: string;
};

export type ActorNode = {
  kind: 'Actor';
  name: string;
  comment?: string;
};

export type ServiceNode = {
  kind: 'Service';
  name: string;
  external: boolean;
  children: DiagramNode[];
  comment?: string;
};

export type DiagramNode =
  | EntityNode
  | EventNode
  | EventHandlerNode
  | QueryNode
  | ActionNode
  | ActorNode
  | ServiceNode;

export type AST = {
  nodes: DiagramNode[];
};

export type Edge = {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
};
