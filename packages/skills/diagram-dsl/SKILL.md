---
name: diagram-dsl
description: Teaches and assists with the service diagram DSL language. Use when the user asks how to write a diagram, what syntax to use, wants to add nodes or connections, or asks about Entity/Event/EventHandler/Query/Action/Actor/external/@either/@unique syntax.
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

Primitive types: `string`, `number`, `boolean`, `Date`

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

---

Now help the user with whatever they need: explaining syntax, writing nodes, fixing parse errors, or designing their service model. Be concrete and give examples. If they describe what they want in plain English, write the DSL for them directly.
