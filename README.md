# @digitizers/sumit-api

> Pure TypeScript helpers for [SUMIT / OfficeGuy / Upay](https://sumit.co.il) recurring billing and trigger webhooks. **Zero runtime dependencies.**

Companion package: [`@digitizers/sumit-react`](https://github.com/Digitizers/sumit-react) — `<SumitCheckout />` plus Next.js charge and webhook route helpers.

---

## Contents

- [Why this package](#why-this-package)
- [Install](#install)
- [Build a recurring-charge payload](#build-a-recurring-charge-payload)
- [Normalize a charge response](#normalize-a-charge-response)
- [Normalize a SUMIT trigger / webhook payload](#normalize-a-sumit-trigger--webhook-payload)
- [Safety](#safety)
- [Development](#development)
- [License](#license)

---

## Why this package

SUMIT (also branded **OfficeGuy** and **Upay**) does not publish a typed SDK for their billing APIs, and their trigger webhooks ship in three different content shapes. This package gives you a small, opinionated surface that is safe to drop into any backend:

- **Build** `/billing/recurring/charge/` request payloads with strict types.
- **Normalize** successful and failed charge responses into a single discriminated union.
- **Parse** SUMIT Trigger / Webhook payloads — JSON, `application/x-www-form-urlencoded`, and SUMIT's `json=…` envelope.
- **Redact** API keys, tokens, card data, emails, and other sensitive fields before logging.

> See [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) for a deeper summary of the SUMIT endpoints, response envelopes, trigger shapes, and redaction rules this package targets.

---

## Install

```bash
pnpm add @digitizers/sumit-api
# or
npm install @digitizers/sumit-api
# or
yarn add @digitizers/sumit-api
```

The package has **no runtime dependencies**.

---

## Build a recurring-charge payload

```ts
import { buildRecurringChargePayload } from "@digitizers/sumit-api";

const payload = buildRecurringChargePayload({
  companyId: 123,
  apiKey: process.env.SUMIT_API_KEY!,
  customer: {
    externalIdentifier: "org_123",
    name: "Acme Ltd",
    emailAddress: "billing@example.com",
  },
  singleUseToken: "[single-use-token-from-client]",
  item: {
    name: "Pro Plan",
    description: "Pro subscription — monthly",
    unitPrice: 19,
    currency: "USD",
    durationMonths: 1,
  },
});
```

---

## Normalize a charge response

```ts
import { normalizeRecurringChargeResponse } from "@digitizers/sumit-api";

const event = normalizeRecurringChargeResponse(sumitResponse);

if (event.ok && event.eventType === "recurring.charged") {
  // Save event.customerId, event.recurringItemId, event.paymentId, event.documentId, ...
}

if (event.ok === false) {
  // Don't activate the subscription. Store event.diagnostic safely.
}
```

A successful SUMIT charge response typically includes:

| Field                            | Meaning                                  |
| -------------------------------- | ---------------------------------------- |
| `Payment.ValidPayment === true`  | Provider considers the charge valid      |
| `Payment.Status === "000"`       | Provider success status code             |
| `RecurringCustomerItemIDs[0]`    | The created recurring-item ID            |
| `CustomerID`                     | SUMIT customer record ID                 |
| `DocumentID`                     | Issued invoice / receipt ID              |

---

## Normalize a SUMIT trigger / webhook payload

```ts
import { normalizeSumitIncomingPayload } from "@digitizers/sumit-api";

const normalized = normalizeSumitIncomingPayload(payloadOrUrlSearchParams);

if (normalized.eventType === "sumit.trigger.unmapped") {
  // Store the sanitized raw event for later mapping.
}
```

SUMIT Trigger webhooks are often view / card based and may not include a fixed provider event schema — this package does **not** assume Stripe-style lifecycle events.

For SUMIT view-shaped trigger payloads with top-level `Folder`, `EntityID`, `Type`, and `Properties`, normalization extracts these safe reconciliation fields when present:

| Normalized field | Source                            |
| ---------------- | --------------------------------- |
| `paymentId`      | `EntityID`                        |
| `customerId`     | `Properties.Property_3[0].ID`     |
| `documentId`     | `Properties.Property_5[0].ID`     |
| `amount`         | `Properties.Billing_Amount[0]`    |
| `status`         | `Type`                            |
| `occurredAt`     | `Properties.Property_2[0]`        |

These events still normalize as `sumit.trigger.unmapped` until your application explicitly authenticates and maps them to a trusted billing lifecycle event.

---

## Safety

> **Never log or persist raw SUMIT payloads.** Use `redactSumitPayload`, or persist only the safe normalized fields.

`redactSumitPayload` masks common sensitive values, including:

- API keys and public API keys
- Single-use tokens
- Card numbers, CVV, expiry, citizen ID
- `Authorization` headers, secrets, passwords
- Email addresses
- Document download URLs
- Long card-like numbers found in arbitrary string fields

---

## Development

```bash
pnpm install
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
pnpm build        # tsc → dist/
```

The build emits ESM with `.d.ts` declarations to `dist/`. Source lives in `src/`.

---

## License

[MIT](LICENSE)
