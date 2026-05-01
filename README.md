# sumit-api

[![npm](https://img.shields.io/npm/v/sumit-api.svg)](https://www.npmjs.com/package/sumit-api)
[![types](https://img.shields.io/npm/types/sumit-api.svg)](https://www.npmjs.com/package/sumit-api)
[![license](https://img.shields.io/npm/l/sumit-api.svg)](LICENSE)
[![zero deps](https://img.shields.io/badge/runtime%20deps-0-success)](package.json)

> Pure TypeScript helpers for [SUMIT](https://sumit.co.il) (formerly **OfficeGuy**) recurring billing and trigger webhooks. SUMIT routes card clearing through partner processors such as **Upay**, and their error codes surface in SUMIT responses — this package handles SUMIT's request/response shapes and redacts those upstream codes before they hit your logs. **Zero runtime dependencies.**

Companion package: [`sumit-react`](https://github.com/Digitizers/sumit-react) — `<SumitCheckout />` plus Next.js charge and webhook route helpers.

---

## Contents

- [Why this package](#why-this-package)
- [Install](#install)
- [Build a one-off charge payload](#build-a-one-off-charge-payload)
- [Build a recurring-charge payload](#build-a-recurring-charge-payload)
- [Normalize a charge response](#normalize-a-charge-response)
- [Normalize a SUMIT trigger / webhook payload](#normalize-a-sumit-trigger--webhook-payload)
- [Safety](#safety)
- [Development](#development)
- [License](#license)

---

## Why this package

SUMIT (formerly **OfficeGuy**) does not publish a typed SDK for their billing APIs, and their trigger webhooks ship in three different content shapes. SUMIT also delegates the actual card clearing to partner processors (**Upay** is one — others exist), so processor-level error codes (e.g. `Upay_30001419`) appear unredacted inside SUMIT's response bodies. This package gives you a small, opinionated surface that is safe to drop into any backend:

- **Build** `/billing/recurring/charge/` request payloads with strict types.
- **Normalize** successful and failed charge responses into a single discriminated union.
- **Parse** SUMIT Trigger / Webhook payloads — JSON, `application/x-www-form-urlencoded`, and SUMIT's `json=…` envelope.
- **Redact** API keys, tokens, card data, emails, and other sensitive fields before logging.

> See [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) for a deeper summary of the SUMIT endpoints, response envelopes, trigger shapes, and redaction rules this package targets.

---

## Install

```bash
pnpm add sumit-api
# or
npm install sumit-api
# or
yarn add sumit-api
```

The package has **no runtime dependencies**.

---

## Build a one-off charge payload

```ts
import { buildOneOffChargePayload } from "sumit-api";

const payload = buildOneOffChargePayload({
  companyId: 123,
  apiKey: process.env.SUMIT_API_KEY!,
  customer: {
    externalIdentifier: "org_123",
    name: "Acme Ltd",
    emailAddress: "billing@example.com",
  },
  singleUseToken: "[single-use-token-from-client]",
  item: {
    name: "Setup fee",
    description: "One-time onboarding charge",
    unitPrice: 49,
    currency: "USD",
  },
});
```

`POST` this body to `https://api.sumit.co.il/billing/payments/charge/`. The response uses the same shape recurring charges return, so [`normalizeChargeResponse`](#normalize-a-charge-response) handles both — a one-off success surfaces as `eventType: "payment.succeeded"` (no `recurringItemId`).

---

## Build a recurring-charge payload

```ts
import { buildRecurringChargePayload } from "sumit-api";

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

`normalizeChargeResponse` handles both one-off and recurring response shapes — a `recurring.charged` event is surfaced only when SUMIT returns a `RecurringCustomerItemIDs[*]`. (`normalizeRecurringChargeResponse` remains exported as an alias.)

```ts
import { normalizeChargeResponse } from "sumit-api";

const event = normalizeChargeResponse(sumitResponse);

if (event.ok && event.eventType === "recurring.charged") {
  // Save event.customerId, event.recurringItemId, event.paymentId, event.documentId, ...
}

if (event.ok && event.eventType === "payment.succeeded") {
  // One-off charge succeeded — store event.paymentId and event.documentId.
}

if (event.ok === false) {
  // Don't activate the subscription / mark the order paid. Store event.diagnostic safely.
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
import { normalizeSumitIncomingPayload } from "sumit-api";

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

`redactSumitPayload` walks the value tree and masks sensitive data via two complementary mechanisms:

| Mechanism | Catches |
| --- | --- |
| **Key-based** (`SENSITIVE_KEY_PATTERN`) | API keys, public keys, single-use tokens, card mask/pattern/token/expiration, citizen ID, card-owner name and social ID, `Authorization`, secrets, passwords, CVV, email addresses, phone, document download URLs, full `CreditCard_*` and `DirectDebit_*` subtrees. |
| **Text-based** (`redactSensitiveText`) | Embedded emails, "Credit Card (1234)" patterns, `token=…` / `apikey=…` key-value strings, `Upay_*` references, UUIDs, 12–19 digit card-like numbers in free text, citizen IDs in keyword context (`citizen`, `ת.ז`, `מ.ז`). |

Form payloads parsed by `normalizeSumitIncomingPayload` reject prototype-pollution keys (`__proto__`, `constructor`, `prototype`) before assembling the nested object — see [`src/index.ts`](src/index.ts).

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
