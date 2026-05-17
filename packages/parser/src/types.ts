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

export type Call = {
  kind: 'Action' | 'Query';
  target: string;
};

export type Tag = 'deprecated' | 'experimental';

export type EntityNode = {
  kind: 'Entity';
  name: string;
  fields: Field[];
  constraints: Constraint[];
  tags: Tag[];
  comment?: string;
};

export type EventNode = {
  kind: 'Event';
  name: string;
  payload: Field[];
  tags: Tag[];
  comment?: string;
};

export type EventHandlerNode = {
  kind: 'EventHandler';
  name: string;
  payload: Field[];
  calls: Call[];
  dispatch: string[];
  tags: Tag[];
  comment?: string;
};

export type QueryNode = {
  kind: 'Query';
  name: string;
  inputs: Field[];
  response: Field[];
  calls: Call[];
  tags: Tag[];
  comment?: string;
};

export type ActionNode = {
  kind: 'Action';
  name: string;
  inputs: Field[];
  response: Field[];
  calls: Call[];
  dispatch: string[];
  tags: Tag[];
  comment?: string;
};

export type ActorNode = {
  kind: 'Actor';
  name: string;
  calls: Call[];
  tags: Tag[];
  comment?: string;
};

export type ServiceNode = {
  kind: 'Service';
  name: string;
  external: boolean;
  children: DiagramNode[];
  tags: Tag[];
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
