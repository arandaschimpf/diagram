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

export type EntityNode = {
  kind: 'Entity';
  name: string;
  fields: Field[];
};

export type EventNode = {
  kind: 'Event';
  name: string;
  payload: Field[];
};

export type EventHandlerNode = {
  kind: 'EventHandler';
  name: string;
  payload: Field[];
  calls: string[];
  dispatch: string[];
};

export type QueryNode = {
  kind: 'Query';
  name: string;
  inputs: Field[];
  response: Field[];
};

export type ActionNode = {
  kind: 'Action';
  name: string;
  inputs: Field[];
  calls: string[];
};

export type XORNode = {
  kind: 'XOR';
  name: string;
  options: string[];
};

export type ActorNode = {
  kind: 'Actor';
  name: string;
};

export type ServiceNode = {
  kind: 'Service';
  name: string;
  external: boolean;
  children: DiagramNode[];
};

export type DiagramNode =
  | EntityNode
  | EventNode
  | EventHandlerNode
  | QueryNode
  | ActionNode
  | XORNode
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
