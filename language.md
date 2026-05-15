# Diagram DSL

A small language for describing service architectures. Write `.diagram` files — the tool parses them, infers connections from type references, and renders a live canvas.

## Node types

| Type | Shape | Purpose |
|------|-------|---------|
| `Service` | container | Groups related nodes; can nest arbitrarily |
| `Entity` | blue rectangle | Data model with typed fields |
| `Event` | yellow rectangle | Domain event with optional payload |
| `EventHandler` | orange rectangle | Reacts to events, calls services, dispatches events |
| `Query` | green rectangle | Read operation with inputs and response |
| `Action` | green diamond | Write/command operation with inputs |
| `XOR` | pink rounded rect | Exclusive branch — a choice between alternatives |
| `Actor` | purple node | External initiator (user, cron, webhook) |

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

```
EventHandler ProcessPayment {
  payload: {
    amount: number
  }
  calls: [
    Stripe::Charge        // cross-service call
  ]
  dispatch: [
    Event PaymentSuccess
    Event PaymentFailed
  ]
}
```

---

## Query

A read operation.

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
}
```

---

## Action

A write operation. `calls` entries draw arrows to dependencies.

```
Action CreateOrder {
  inputs: {
    userId: string
    items:  OrderItem[]
  }
  calls: [
    Inventory::ReserveStock
  ]
}
```

---

## XOR

An exclusive branch — represents a point where the flow takes one of several paths.

```
XOR OrderOutcome {
  options: [OrderPlaced, PaymentFailed]
}
```

---

## Actor

An external agent that initiates flows. No fields.

```
Actor User
Actor StripeWebhook
```

---

## How connections are inferred

Arrows require no manual wiring — they come from the data:

- **Entity field** whose type is another node → arrow (dashed if `| null` or `?`)
- **EventHandler `calls`** → arrow to each listed node
- **EventHandler `dispatch`** → arrow to each listed event
- **Action `calls`** → arrow to each listed node

---

## Full example

```
Actor User

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

  Event OrderPlaced
  Event PaymentFailed

  EventHandler ProcessPayment {
    payload: {
      amount:   number
      currency: string
    }
    calls: [
      Stripe::Charge
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

  XOR OrderOutcome {
    options: [OrderPlaced, PaymentFailed]
  }
}
```
