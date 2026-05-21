# Diagram DSL

A small language for describing service architectures. Write `.diagram` files — the tool parses them, infers connections from type references, and renders a live canvas.

## Node types

| Type           | Shape            | Purpose                                             |
| -------------- | ---------------- | --------------------------------------------------- |
| `Service`      | container        | Groups related nodes; can nest arbitrarily          |
| `Entity`       | blue rectangle   | Data model with typed fields and constraints        |
| `Enum`         | teal rectangle   | Closed set of named variants                        |
| `Event`        | yellow rectangle | Domain event with optional payload                  |
| `EventHandler` | orange rectangle | Reacts to events, calls services, dispatches events |
| `Query`        | green rectangle  | Read operation with inputs and response             |
| `Action`       | green diamond    | Write/command operation with inputs                 |
| `Actor`        | purple node      | External initiator (user, cron, webhook)            |
| `Type`         | gray rectangle, or invisible if bodyless | Value type / data shape; bodyless acts as an opaque primitive |
| `StateMachine` | slate compact card | Entity lifecycle: states and named transitions    |
| `View`         | (no canvas presence) | Named saved filter — show a subset of the diagram |

---

## Service

Groups nodes. Services nest arbitrarily — a service can contain both child services and direct nodes at the same level.

```
Service Orders {
  Entity Order { ... }
  Service Fulfillment {
    Action ShipOrder { ... }
  }
}
```

Add `external` to mark third-party systems — they render with a dashed border.

```
external Service Stripe {
  Query Charge { ... }
}
```

### Interfaces & Implementations

Declare an interface service using the `interface` keyword:

```
interface Service AbstractWalletService {
  Action Transfer { ... }
}
```

Implement an interface service using the `implements` keyword:

```
Service Fordefi implements AbstractWalletService {
  Action Transfer { ... }
}
```

The implementing service inherits all children of the interface; any child re-declared by name in the implementer overrides the inherited one. The linter warns if the implemented target is unknown or is not declared as `interface Service`.

---

## Entity

A data model. Fields whose types reference other nodes become arrows in the diagram.

```
Entity Order {
  order_id:   string
  user_id:    User           // → solid arrow to User
  payment_id: Payment | null // → dashed arrow (nullable)
  items:      OrderItem[]    // → arrow (array)
  created_at: Date
  note?:      string         // optional field
}
```

**Primitive types:** `string`, `number`, `boolean`, `Date`, `UUID` (plus any declared as a bodyless `Type` — see below)

Cross-service references use `::` paths: `Platform::Auth::User`

### Constraints

Entity-level constraints are declared with `@` tags after the fields.

**`@either`** — exactly one of the listed fields must be set (mutual exclusion):

```
@either: [order_id, payout_id]
```

**`@unique`** — composite unique constraint across the listed fields. Repeat for multiple constraints:

```
@unique: [funding_id, order_id]
@unique: [funding_id, payout_id]
```

Full example:

```
Entity FundingAllocation {
  allocation_id: string
  funding_id:    Funding
  order_id:      string | null
  payout_id:     Payout | null
  amount:        number

  @either:  [order_id, payout_id]
  @unique:  [funding_id, order_id]
  @unique:  [funding_id, payout_id]
}
```

---

## Enum

A closed set of named variants. Reference it from an entity field to draw an arrow.

```
Enum OrderStatus {
  pending
  shipped
  delivered
  cancelled
}

Entity Order {
  order_id: string
  status:   OrderStatus   // → arrow to OrderStatus
}
```

Variants are bare identifiers, one per line (commas optional). Enums support a leading `//` comment and lifecycle tags.

---

## Event

A domain event. Payload is optional.

```
Event OrderPlaced

Event PaymentReceived {
  transaction_hash: string
  amount:           number
}
```

---

## EventHandler

Handles incoming events. Arrows are drawn to every node in `calls` and `dispatch`.

Each `calls` entry **must** be prefixed with `Action` or `Query` (matching the kind of the target node). Unprefixed entries are silently ignored.

```
EventHandler ProcessPayment {
  payload: {
    amount: number
  }
  calls: [
    Action Stripe::Charge       // cross-service action
    Query  Pricing::GetPrice    // cross-service query
  ]
  dispatch: [
    Event PaymentSuccess
    Event PaymentFailed
  ]
}
```

---

## Query

A read operation. Can declare synchronous `calls` to other queries or actions it needs to fulfill the read (same `Action`/`Query` prefix as `EventHandler.calls`).

```
Query GetOrders {
  inputs: {
    userId: string
    status?: string
  }
  response: {
    data: Order[]
    total: number
  }
  calls: [
    Query Pricing::GetPrice
  ]
}
```

---

## Action

A write operation. `calls` entries draw arrows to dependencies; each entry must be prefixed with `Action` or `Query`. Actions can also emit events via `dispatch:` (same `Event` prefix as `EventHandler`) and declare a `response:` block for the data they return.

```
Action CreateOrder {
  inputs: {
    userId: string
    items:  OrderItem[]
  }
  response: {
    orderId: string
    status:  string
  }
  calls: [
    Action Inventory::ReserveStock
    Query  Pricing::GetPrice
  ]
  dispatch: [
    Event OrderCreated
    Event OrderFailed
  ]
}
```

---

## Actor

An external agent that initiates flows (user, cron, webhook). Supports an optional body with a leading comment and/or a `calls` list. Actor calls target `Action` and `Query` nodes only — actors do not dispatch events.

```
Actor User
Actor StripeWebhook

Actor AdminDashboard {
  // Internal tool used by the ops team
  calls: [
    Action Orders::CancelOrder
    Query  Orders::GetOrders
  ]
}
```

---

## Type

Declares a value type / data shape. `Type` has two forms:

**Bodyless** — an opaque primitive name. Useful for `object`, `Json`, `Buffer`, etc., where you don't want a node on the canvas and don't want the linter flagging the type as unknown.

```
Type object
Type Json

Entity Event {
  id:       string
  metadata: object | null   // no warning, no arrow
  payload:  Json
}
```

Bodyless declarations render nothing on the canvas and are looked up globally regardless of where they are declared. Tags can attach inline: `Type Json @experimental`.

**Bodied** — a named record type with fields. Renders as a neutral gray card to distinguish it from Entities. References from other nodes draw arrows to it.

```
Type Money {
  amount:   number
  currency: string
}

Entity Invoice {
  invoice_id: string
  total:      Money        // → arrow to Money
}
```

Bodied Types support `@deprecated` / `@experimental` tags, a leading `//` comment, and optional fields (`field?: T`). They do **not** carry `@unique` / `@either` constraints — those imply identity, which belongs on `Entity`. Bodied Types are scoped to their declaring service like Entities: `Service Billing { Type Money { ... } }` has the qualified id `Billing::Money`; resolution is sibling-first, then qualified.

---

## StateMachine

Describes the state lifecycle of an entity: the valid states and the named transitions between them. Renders as a compact card with state badges and a transition count; click the expand button to open a modal showing the full state graph and a transition-trigger reference column.

```
StateMachine OrderStatus {
  @initial QUOTED {
    CONFIRM -> PENDING_FUNDING
  }
  PENDING_FUNDING {
    ALLOCATE_FUNDS -> PARTIALLY_FILLED
    FULLY_FUNDED   -> FULFILLED
    EXPIRE         -> EXPIRED
    CANCEL         -> CANCELLED
  }
  FULFILLED {
    START_PAYOUT -> PROCESSING_PAYOUT
  }
  PROCESSING_PAYOUT {
    PAYOUT_SUCCEEDED -> SETTLED
    PAYOUT_FAILED    -> PAYOUT_FAILED
  }
  PAYOUT_FAILED {
    RETRY_PAYOUT -> PROCESSING_PAYOUT
  }
  SETTLED   {}
  EXPIRED   {}
  CANCELLED {}
}
```

**Rules:**
- Exactly one state must be marked `@initial`. Entity creation is implicit — `@initial` is the state an entity lands in when first created.
- Each state's body declares transitions as `TRIGGER -> TARGET_STATE`.
- Empty bodies (`SETTLED {}`) declare terminal states.
- The same trigger name may appear in multiple states (e.g. `EXPIRE`), but must be unique within any single source state.
- Self-loops (`A -> A`) are errors. To represent a retry, route through a separate state.

**Referencing from entities** — a StateMachine can be used as a field type in two forms:

```
Entity OrderStatusChange {
  order_status_change_id: UUID
  order_id:    UUID
  from_status: OrderStatus              // enum of state names
  to_status:   OrderStatus
  trigger:     OrderStatus.Transition   // enum of unique trigger names
}
```

- Bare `OrderStatus` → enum-like type of state names.
- `OrderStatus.Transition` → enum-like type of the unique trigger names across the entire machine. Repeated trigger names collapse to one variant.

Multiple field references to the same StateMachine collapse to a single arrow on the canvas.

StateMachines may carry a top-of-body `//` comment and `@deprecated` / `@experimental` tags. States and transitions may carry leading `//` comments — these appear in the drill-down's trigger reference column.

---

## View

A top-level, named saved filter. Picking a View from the canvas toolbar redraws the diagram showing only the listed nodes, auto-compacted. Views aren't drawn on the canvas, don't take part in edge inference, and are not a grouping construct — they're metadata for the renderer.

```
View CustodySubsystem {
  include: [
    AbstractWalletService.*
    FundsService.*
    Orders::CancelOrder
  ]
}
```

**Include entries:**
- `Name` — include just that node (a leaf, or a Service container without its children).
- `Name.*` — include the Service **and all its descendants**. Only meaningful on a Service; using it on a leaf is a warning.
- Resolution matches the rest of the language: short names look up at the top level, `Service::Sub::Node` works for qualified references.

**Behavior:**
- Pure filter: anything not listed is hidden. Edges crossing into hidden nodes disappear (no stubs).
- No automatic pickup. Implementing services (`Service Fordefi implements AbstractWalletService`), actors, external services, and callers must each be listed explicitly. Including an interface does **not** pull in its implementations.
- Ancestor services of any included node are auto-included so the parent chain still renders (listing `Orders::CancelOrder` brings `Orders` along, but not `Orders`' other children).
- Multiple `View` blocks per file are fine. Views must be top-level — they cannot be nested inside a Service.
- Layout while a View is active is auto-compacted on the fly; positions aren't persisted per view. The full diagram keeps its existing saved layout.

**Lint:**
- Error: an include entry that doesn't resolve.
- Warning: a visible node whose only incoming references come from hidden nodes (it'll render isolated).

---

## Lifecycle tags

Mark any node with body-level lifecycle metadata. Two tags are supported:

- `@deprecated` — node is on its way out; callers should migrate away.
- `@experimental` — node is new/unstable; signature may change.

Tags work on every node type with a body (`Entity`, `Event`, `EventHandler`, `Query`, `Action`, `Actor`, `Service`). Tags are orthogonal — a node can carry both. Only leading tags (at the top of the body, after any comment) are captured; tags written later in the body are silently ignored. For nodes that normally have no body (`Event` without payload, `Actor`), add a body solely to carry tags.

```
Service Orders {
  @deprecated

  Action CreateOrder {
    @experimental
    inputs: { userId: string }
  }

  Event OrderCreated {
    @deprecated
  }
}
```

Tags do not affect edge inference; they are metadata for the renderer.

---

## Comments

Any node with a `{}` body supports a description comment. Write one or more consecutive `//` lines at the very top of the body — they are captured and rendered on the canvas card.

```
Service Auth {
  // Handles authentication and session management

  Entity Session {
    // Created on login, expires after 30 min
    id:      string
    userId:  string
  }

  Action Login {
    // Validates credentials and issues a session token
    inputs: {
      email:    string
      password: string
    }
  }

  Event SessionExpired {
    // Fired by the cleanup job
  }
}
```

`Actor` supports an optional `{}` body solely for a comment:

```
Actor StripeWebhook {
  // External webhook from Stripe payment events
}
```

Mid-body `//` lines (after fields) are silently ignored; only leading ones are captured.

---

## Linting

Some problems parse cleanly but don't mean what you think — a typo in a field type, an unprefixed `calls` entry (silently dropped), a `dispatch` that targets something other than an `Event`. Run the linter to surface them:

```
martin-diagram lint path/to/file.diagram
```

Each diagnostic includes severity, message, and line number. Checks include:

- Entity fields whose type references an unknown node
- `@either` / `@unique` constraints referencing fields that don't exist
- `calls` / `dispatch` entries missing their required prefix
- `calls` / `dispatch` targets that don't resolve, or resolve to the wrong kind
- StateMachine: undeclared transition target; missing/duplicate `@initial`; duplicate trigger in one state; self-loops; unreachable states

Lint warnings are advisory — they don't stop the file from rendering.

---

## How connections are inferred

Arrows require no manual wiring — they come from the data:

- **Entity field** whose type is another node → arrow (dashed if `| null` or `?`)
  - Multiple references between the same two nodes collapse to a single edge.
  - `StateMachine.Transition` resolves to the StateMachine for edge purposes.
- **EventHandler `calls`** → arrow to each `Action`/`Query` listed
- **EventHandler `dispatch`** → arrow to each listed event
- **Action `calls`** → arrow to each `Action`/`Query` listed
- **Action `dispatch`** → arrow to each listed event
- **Actor `calls`** → arrow to each `Action`/`Query` listed

---

## Full example

```
Actor User {
  calls: [
    Action Orders::CancelOrder
    Query  Orders::GetOrders
  ]
}

external Service Stripe {
  Query Charge {
    inputs:   { amount: number }
    response: { success: boolean }
  }
}

Service Orders {
  Entity Order {
    order_id:   string
    user_id:    string
    amount:     number
    status:     string
    created_at: Date
  }

  Entity FundingAllocation {
    allocation_id: string
    funding_id:    Order
    order_id:      string | null
    payout_id:     string | null
    amount:        number

    @either: [order_id, payout_id]
    @unique: [funding_id, order_id]
    @unique: [funding_id, payout_id]
  }

  Event OrderPlaced
  Event PaymentFailed

  EventHandler ProcessPayment {
    payload: {
      amount:   number
      currency: string
    }
    calls: [
      Query Stripe::Charge
    ]
    dispatch: [
      Event OrderPlaced
      Event PaymentFailed
    ]
  }

  Query GetOrders {
    inputs:   { userId: string }
    response: { data: Order[] }
  }

  Action CancelOrder {
    inputs: { orderId: string }
  }
}
```
