# Diagram DSL

A small language for describing service architectures. Write `.diagram` files — the tool parses them, infers connections from type references, and renders a live canvas.

## Node types

| Type           | Shape            | Purpose                                             |
| -------------- | ---------------- | --------------------------------------------------- |
| `Service`      | container        | Groups related nodes; can nest arbitrarily          |
| `Entity`       | blue rectangle   | Data model with typed fields and constraints        |
| `Event`        | yellow rectangle | Domain event with optional payload                  |
| `EventHandler` | orange rectangle | Reacts to events, calls services, dispatches events |
| `Query`        | green rectangle  | Read operation with inputs and response             |
| `Action`       | green diamond    | Write/command operation with inputs                 |
| `Actor`        | purple node      | External initiator (user, cron, webhook)            |

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

**Primitive types:** `string`, `number`, `boolean`, `Date`

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

## How connections are inferred

Arrows require no manual wiring — they come from the data:

- **Entity field** whose type is another node → arrow (dashed if `| null` or `?`)
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
