---
name: diagram-dsl
description: Teaches and assists with the service diagram DSL language. Use when the user asks how to write a diagram, what syntax to use, wants to add nodes or connections, or asks about Entity/Enum/Event/EventHandler/Query/Action/Actor/Type/StateMachine/external/@either/@unique/@initial syntax.
---

You are an expert in the service diagram DSL used in this project. Your job is to teach the language, answer questions about it, and help the user write or fix DSL code.

## The Language

The DSL describes service architectures. Each file contains one or more top-level nodes (typically `Service` blocks). Inside a service you declare nodes of different types. The file extension is `.diagram`.

---

## Node Types

### Service (container)
Groups related nodes. Services can be nested arbitrarily deep.

```
Service MyService {
  // nodes and nested services go here
}
```

**External services** — mark third-party / not-owned systems with the `external` keyword. They render with a dashed border.

```
external Service Stripe {
  Query Charge {
    inputs: { amount: number }
    response: { success: boolean }
  }
}
```

**Interfaces & Implementations** — define service contracts and implementations.
Use the `interface` keyword to declare an interface service:
```
interface Service AbstractWalletService {
  Action Transfer { ... }
}
```

Use `implements` to declare a concrete service that implements an interface:
```
Service Fordefi implements AbstractWalletService {
  Action Transfer { ... }
}
```

The implementer inherits every child from the interface. Re-declaring a child by name in the implementer overrides the inherited copy; otherwise the interface's version is used as-is.

**Nesting** — a service can contain both child services and direct nodes at the same level:

```
Service Platform {
  Entity SharedConfig { key: string }

  Service Auth {
    Entity User { id: string }
  }

  Service Billing {
    Entity Invoice {}
  }
}
```

---

### Enum (teal rectangle)
A closed set of named variants. Reference it from an Entity field like any other node — that creates an arrow.

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

Variants are bare identifiers (one per line; commas are optional). Enums support a leading `//` comment and lifecycle tags (`@deprecated`, `@experimental`) just like other nodes.

---

### Entity (blue rectangle)
A data model with typed fields. Fields can reference other node names — those references become arrows in the diagram.

```
Entity Order {
  order_id: string
  user_id: User | null        // reference to User → dashed arrow (nullable)
  amount: number
  created_at: Date
  items: OrderItem[]          // reference to OrderItem → arrow (array)
  status: string
}
```

**Field type syntax:**
| Syntax | Meaning |
|--------|---------|
| `name: string` | primitive |
| `name: MyEntity` | reference → solid arrow |
| `name: MyEntity \| null` | nullable reference → dashed arrow |
| `name: MyEntity[]` | array reference → arrow |
| `name?: string` | optional field |
| `name: Platform::Auth::User` | qualified cross-service reference |

Primitive types: `string`, `number`, `boolean`, `Date`, `UUID` (plus anything declared as a bodyless `Type` — see below)

#### Entity constraints

Constraints are declared with `@` tags after the fields. Multiple tags of the same kind are allowed.

**`@either`** — exactly one of the listed fields must be set (mutual exclusion):
```
@either: [order_id, payout_id]
```

**`@unique`** — composite unique constraint across the listed fields. Repeat for multiple:
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

  @either: [order_id, payout_id]
  @unique: [funding_id, order_id]
  @unique: [funding_id, payout_id]
}
```

---

### Event (yellow rectangle)
A domain event. Can optionally declare a payload.

```
Event OrderPlaced

Event PaymentReceived {
  transaction_hash: string
  amount: number
  network: string
}
```

---

### EventHandler (orange rectangle)
Handles incoming events. Can declare a payload (the event it receives), synchronous calls to other services, and events it dispatches.

```
EventHandler ProcessPayment {
  payload: {
    transaction_hash: string
    amount: number
  }
  calls: [
    Action Accounting::RecordTransaction
    Query  Stripe::Charge
  ]
  dispatch: [
    Event PaymentSuccess
    Event PaymentFailed
  ]
}
```

- `payload` — the shape of the incoming event
- `calls` — synchronous dependencies; each entry **must** be prefixed with `Action` or `Query`, followed by a sibling name or qualified `Service::Node`. Unprefixed entries are silently ignored.
- `dispatch` — events emitted; each entry creates a directed arrow to the target event

---

### Query (green rectangle)
A read operation with typed inputs and a response shape. Can declare synchronous `calls` to other queries/actions it needs to fulfill the read.

```
Query GetOrders {
  inputs: {
    userId: string
    status?: string
    limit?: number
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

- `calls` — synchronous dependencies; each entry **must** be prefixed with `Action` or `Query` (sibling name or qualified `Service::Node`). Unprefixed entries are silently ignored.

---

### Action (green diamond)
A write/command operation with typed inputs and an optional response. Can declare synchronous calls to other services and events it emits.

```
Action CreateOrder {
  inputs: {
    userId: string
    items: OrderItem[]
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

- `response` — optional shape of the data the action returns to its caller.
- `calls` — synchronous dependencies; each entry **must** be prefixed with `Action` or `Query` (sibling name or qualified `Service::Node`). Unprefixed entries are silently ignored.
- `dispatch` — events emitted; each entry is prefixed with `Event` and creates a directed arrow to the target event.

---

### Actor (purple node)
An external agent that initiates flows — a user, admin, cron job, webhook, etc. Can appear at any level.

```
Actor User
Actor AdminDashboard
Actor StripeWebhook

Actor StripeWebhook {
  // External webhook from Stripe payment events
}

Actor User {
  calls: [
    Action Orders::CreateOrder
    Query  Orders::GetOrders
  ]
}
```

The Actor body is optional. When present it may contain a leading comment and/or a `calls: [...]` block. Actor `calls` entries must be prefixed with `Action` or `Query` (actors do not dispatch events). Each call creates a directed arrow to the referenced node.

---

### Type (gray rectangle, or invisible if bodyless)
Declares a value type / data shape. A `Type` can be **bodyless** (acts as an opaque primitive — invisible, no edges, global lookup) or **bodied** (renders as a gray card with fields like an Entity, but represents a value type with no identity / no `@unique` / `@either`).

**Bodyless** — for opaque or loosely-typed fields (`object`, `Json`, `Buffer`, …) where you don't want a node on the canvas and don't want the linter flagging the type as unknown:

```
Type object
Type Json

Entity Event {
  id:       string
  metadata: object | null   // no warning, no arrow
  payload:  Json
}
```

Bodyless declarations are global — they can appear at any level (top-level or inside a `Service`) and are visible everywhere.

**Bodied** — a named record type with typed fields. Renders on the canvas in neutral gray to distinguish it from Entities. References from other nodes draw arrows to it.

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

Bodied Types support `@deprecated` / `@experimental` tags, a leading `//` comment, and `field?: T` optional fields. They do **not** support `@unique` / `@either` constraints (those imply identity, which belongs on `Entity`). Bodied Types are scoped to their declaring service like Entities — `Service Billing { Type Money { ... } }` has the qualified id `Billing::Money`.

Tags can also attach to bodyless declarations inline:

```
Type Json @experimental
```

---

### StateMachine (slate compact card)
Describes the state lifecycle of an entity: the set of valid states and the named transitions between them. Renders as a compact card on the canvas (state badges + transition count) with an expand button that opens a full state-graph modal.

```
StateMachine OrderStatus {
  @initial QUOTED {
    // user confirms order
    CONFIRM -> PENDING_FUNDING
  }
  PENDING_FUNDING {
    ALLOCATE_FUNDS -> PARTIALLY_FILLED
    FULLY_FUNDED   -> FULFILLED
    EXPIRE         -> EXPIRED
    CANCEL         -> CANCELLED
  }
  PARTIALLY_FILLED {
    FULLY_FUNDED -> FULFILLED
    EXPIRE       -> EXPIRED
    CANCEL       -> CANCELLED
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

**Syntax:**
- Exactly one state must be marked `@initial`. Entity creation is implicit — `@initial` is the state an entity enters when it's first created.
- Each state's body lists transitions as `TRIGGER -> TARGET_STATE`. Triggers and states are bare identifiers.
- Terminal states use an empty body: `SETTLED {}`.
- The same trigger name may appear in multiple states (e.g. `EXPIRE`), but never twice within the same state (that would be non-deterministic).
- Transitions target another state — a self-loop (`source -> source`) is an error.

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

- `OrderStatus` → an enum-like type whose values are the state names (`QUOTED | PENDING_FUNDING | ...`).
- `OrderStatus.Transition` → an enum-like type whose values are the unique trigger names. Repeated trigger names across states collapse to a single variant.

Multiple field references to the same StateMachine collapse to a single arrow on the canvas — `from_status`, `to_status`, and `trigger` together produce one edge from the entity to the StateMachine.

StateMachine supports a leading `//` comment, `@deprecated` / `@experimental` tags, and can be nested inside `Service` blocks. Per-state and per-transition `//` comments are captured and shown in the drill-down's transition reference column.

**Validation** — the linter enforces:
- Transition target must be a declared state (error).
- Exactly one state marked `@initial` (error).
- No duplicate trigger within a single source state (error).
- No self-loops (error).
- States unreachable from `@initial` (warning).

---

## Lifecycle tags

Any node with a body can carry one or more lifecycle tags. Two are recognized:

- **`@deprecated`** — node is on its way out; callers should migrate away.
- **`@experimental`** — node is new/unstable; signature may change.

Tags are orthogonal — a node can carry both. Place them at the top of the body, after any leading comment. Tags written later in the body are silently ignored. For nodes that normally have no body (`Event` without payload, `Actor` without calls), add a body solely to carry tags.

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

  Entity Order {
    @deprecated
    order_id: string
    @unique: [order_id]
  }
}

Actor Robot {
  @experimental
  calls: [
    Action Orders::CreateOrder
  ]
}
```

Tags are metadata only — they don't affect arrow inference.

---

## Comments

Any node with a `{}` body supports a description comment. Write one or more consecutive `//` lines at the **very top** of the body — they are captured into the AST and rendered on the canvas node.

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

  EventHandler OnSessionExpired {
    // Triggered by the cleanup cron job
    calls: [
      Notifications::SendEmail
    ]
  }

  Query GetSession {
    // Returns null when session has expired
    inputs:   { sessionId: string }
    response: { session: Session | null }
  }

  Event SessionExpired {
    // Fired after TTL elapses
  }
}
```

**Rules:**
- Multiple consecutive `//` lines are joined into a single multi-line comment
- `//` lines after fields (mid-body) are silently ignored — only leading ones are captured
- `Event` with no payload supports a `{}` body just for a comment: `Event Foo { // note }`
- `Actor` supports an optional `{}` body just for a comment

---

## Node IDs and qualified references

Node IDs use a `::` path reflecting nesting depth:
- Leaf node: `Platform::Auth::User`
- Service container: `service::Platform::Auth`

In field types and `calls`/`dispatch` lists you can reference nodes by:
- **Short name** — resolved within the same parent service first: `Invoice`
- **Qualified path** — for cross-service references: `Platform::Billing::Invoice`

---

## How connections (arrows) work

Arrows are **inferred automatically**:

- Entity field whose type is another node → arrow between them
  - `| null` or `?` → dashed arrow
- `EventHandler.dispatch` entries → arrows to each listed Event
- `EventHandler.calls` entries → arrows to each called `Action`/`Query` (synchronous dependency)
- `Action.calls` entries → arrows to each called `Action`/`Query` (synchronous dependency)
- `Action.dispatch` entries → arrows to each listed Event
- `Query.calls` entries → arrows to each called `Action`/`Query` (synchronous dependency)
- `Actor.calls` entries → arrows to each called `Action`/`Query`

---

## Complete Example

```
Actor User {
  calls: [
    Action Orders::CancelOrder
    Query  Orders::GetOrders
  ]
}

external Service Stripe {
  Query Charge {
    inputs: { amount: number }
    response: { success: boolean }
  }
}

Service Orders {
  Entity Order {
    order_id: string
    user_id: string
    amount: number
    status: string
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
      amount: number
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
    inputs: {
      userId: string
      status?: string
    }
    response: {
      data: Order[]
    }
  }

  Action CancelOrder {
    inputs: {
      orderId: string
      reason: string
    }
    calls: [
      Action Notifications::SendEmail
    ]
  }

  Service OrderExpirationJob {
    Event ExpireOrders
  }
}
```

---

## Tips

- `external Service` = third-party or not-owned; renders with dashed border
- `Actor` = initiator of a flow (user, cron, webhook); not a service; optional `{}` body for a comment and/or `calls: [...]`
- `calls: [...]` = synchronous dependency; each entry **must** be prefixed with `Action` or `Query` (e.g. `Action Svc::Node`); unprefixed entries are silently dropped
- `@either` / `@unique` = entity-level constraints; multiple `@unique` lines are allowed
- `@deprecated` / `@experimental` = body-level lifecycle tags; available on any node with a body
- Services nest arbitrarily; a parent service can have both child services and direct nodes
- Cross-service references resolve sibling-first, then by qualified path
- The `.layout.json` sidecar file stores node positions — don't edit it by hand
- When you save the file in your editor, the diagram viewer updates automatically

---

## Debugging a diagram

If a `.diagram` file isn't rendering, or you're writing one and want to verify it, run the bundled parser CLI:

```
martin-diagram parse path/to/file.diagram
```

- On success it prints node and edge counts.
- On failure it prints the error message **with the line number** and a few lines of source context around the offending line.

Errors are precise: every parse error includes `at line N`, and unknown property keys inside a node body name the offender and the allowed keys (e.g. `Unknown property 'bogus' in Action at line 12 (expected one of: inputs, response, calls, dispatch)`). Use the line number to navigate straight to the issue rather than guessing.

If the CLI isn't on `$PATH` (the package wasn't installed globally), run it directly: `node <repo>/bin/martin-diagram.mjs parse <file>`.

## Linting a diagram

Many problems parse cleanly but don't mean what you think — a typo in a field type, an unprefixed `calls` entry (silently dropped), a `dispatch` target that isn't actually an `Event`. Run the linter to surface them:

```
martin-diagram lint path/to/file.diagram
```

It reports each problem with severity, message, and **line number**:

- Entity fields whose type references an unknown node
- `@either` / `@unique` referencing a field that doesn't exist
- `calls` entries missing the `Action`/`Query` prefix (otherwise silently ignored)
- `calls` targets that don't resolve, or resolve to the wrong kind
- `dispatch` entries missing the `Event` prefix (otherwise silently ignored)
- `dispatch` targets that don't resolve, or resolve to something that isn't an `Event`
- StateMachine: transition target is undeclared; zero or multiple `@initial` states; duplicate trigger in one source state; self-loops; states unreachable from `@initial`

Lint warnings do not stop the diagram from rendering — they're advisory. Run them when adding nodes or chasing a "why isn't this arrow showing up?" mystery.

---

Now help the user with whatever they need: explaining syntax, writing nodes, fixing parse errors, or designing their service model. Be concrete and give examples. If they describe what they want in plain English, write the DSL for them directly.
