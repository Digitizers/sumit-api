# @digitizers/sumit-api

TypeScript helpers for integrating with SUMIT / OfficeGuy / Upay billing flows.

This package intentionally focuses on provider-specific pure logic that can be reused across apps:

- Build `/billing/recurring/charge/` request payloads.
- Normalize successful and failed recurring-charge responses.
- Normalize SUMIT Trigger/Webhook payloads, including view-shaped payloads without a Stripe-style `EventType`.
- Parse JSON-like and `application/x-www-form-urlencoded` trigger fields through `URLSearchParams`.
- Redact sensitive provider/payment data before writing diagnostics to logs or databases.

## Install

```bash
pnpm add @digitizers/sumit-api
```

The package has no runtime dependencies.

## Example: recurring charge payload

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
    description: "Pro subscription - monthly",
    unitPrice: 19,
    currency: "USD",
    durationMonths: 1,
  },
});
```

## Example: normalize a charge response

```ts
import { normalizeRecurringChargeResponse } from "@digitizers/sumit-api";

const event = normalizeRecurringChargeResponse(sumitResponse);

if (event.ok && event.eventType === "recurring.charged") {
  // Save event.customerId, event.recurringItemId, event.paymentId, etc.
}

if (event.ok === false) {
  // Do not activate the subscription. Store event.diagnostic safely.
}
```

Observed successful SUMIT charge responses usually include:

```ts
Payment.ValidPayment === true
Payment.Status === "000"
RecurringCustomerItemIDs[0]
CustomerID
DocumentID
```

## Example: normalize a SUMIT Trigger/Webhook payload

```ts
import { normalizeSumitIncomingPayload } from "@digitizers/sumit-api";

const normalized = normalizeSumitIncomingPayload(payloadOrUrlSearchParams);

if (normalized.eventType === "sumit.trigger.unmapped") {
  // Store the sanitized raw event for later mapping.
}
```

SUMIT Trigger webhooks are often view/card based and may not include a fixed provider event schema. This package does not assume Stripe-style lifecycle events.

For SUMIT view-shaped trigger payloads with top-level `Folder`, `EntityID`, `Type`, and `Properties`, normalization extracts safe reconciliation fields when present:

- `paymentId` from `EntityID`
- `customerId` from `Properties.Property_3[0].ID`
- `documentId` from `Properties.Property_5[0].ID`
- `amount` from `Properties.Billing_Amount[0]`
- `status` from `Type`
- `occurredAt` from `Properties.Property_2[0]`

These events still normalize as `sumit.trigger.unmapped` unless the application explicitly authenticates and maps them to a trusted billing lifecycle event.

## Safety

Never log or persist raw provider payloads. Use `redactSumitPayload` or store only the safe normalized fields.

The redactor masks common sensitive values including API keys, public API keys, single-use tokens, card fields, authorization headers, secrets, passwords, emails, document download URLs, and long card-like numbers.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## License

MIT
