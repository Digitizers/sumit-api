# SUMIT API Reference

This package wraps a small slice of the SUMIT / OfficeGuy / Upay billing API. It does **not** ship a transport client — `fetch` is the integrator's responsibility. The helpers here build the request body, normalize responses, and redact sensitive fields before logging.

## Official sources

- REST portal: <https://app.sumit.co.il/developers/api/>
- Swagger UI: <https://app.sumit.co.il/help/developers/swagger/index.html>
- Raw OpenAPI 3.1 spec (no auth): <https://app.sumit.co.il/swagger/v1/swagger.json>

## Base URL

```text
https://api.sumit.co.il
```

All endpoints are `POST` with a JSON body and JSON response.

## Authentication

Every request includes a `Credentials` object on the body:

```jsonc
{
  "Credentials": {
    "CompanyID": 123,        // numeric SUMIT company id
    "APIKey": "<server>"     // private key — server-side only
  }
}
```

- `APIKey` is a **server-side secret**. Never ship it to the browser.
- `APIPublicKey` (different field, used by the browser tokenization SDK) produces a one-shot `SingleUseToken`. The token is consumed by the first charge attempt.

## Standard response envelope

Every endpoint returns the same outer wrapper:

```jsonc
{
  "Status": "Success",            // ResponseStatus enum: Success / GeneralError / ...
  "UserErrorMessage": null,
  "TechnicalErrorDetails": null,
  "Data": { /* endpoint-specific payload */ }
}
```

> ⚠️ The outer `Status` is the framework-level `ResponseStatus` enum, **not** the payment status code (`"000"`, `"001"`, …). The payment code lives on `Data.Payment.Status`. Trigger payloads sometimes flatten `Data` to the top level — `normalizeRecurringChargeResponse` checks both shapes.

## Endpoints covered by this package

### `POST /billing/recurring/charge/`

> Charge customer and create recurring payment.

Built by [`buildRecurringChargePayload`](../src/index.ts):

```ts
{
  Credentials: { CompanyID, APIKey },
  Customer: {
    ExternalIdentifier: string,
    SearchMode: 2,            // see SearchMode enum below
    Name: string,
    EmailAddress: string,
  },
  SingleUseToken: string,     // omit if reusing customer's stored payment method
  Items: [{
    Item: { Name, Description, Duration_Months },
    Quantity: number,         // default 1
    UnitPrice: number,
    Currency: 0 | 1 | 2,      // see Currency table
    Duration_Months: number,  // duplicated at item-parent level — required by SUMIT
    Recurrence: number,       // 0 / null = continuous; 12 = 12 payments and stop
  }],
  VATIncluded: boolean,       // defaults to false in SUMIT; this lib defaults to true
  OnlyDocument: boolean,      // generate doc without charging
  AuthoriseOnly?: true,       // omit unless capturing an auth-only attempt
}
```

> ⚠️ `AuthoriseOnly: true` creates the document as **Draft** and the recurring item as **cancelled** — useful for sanity-checking integration without a real charge, but the resulting `RecurringCustomerItemIDs` are *not* live subscriptions.

`Data` payload on success:

```jsonc
{
  "Payment": {
    "ID": 111,
    "CustomerID": 222,
    "Date": "2026-04-30T17:46:17+03:00",
    "ValidPayment": true,
    "Status": "000",                    // "000" / "0" indicate success
    "StatusDescription": "מאושר (קוד 000)",
    "Amount": 1,
    "Currency": 1,
    "PaymentMethod": { /* CreditCard_* or DirectDebit_* fields — sensitive */ },
    "AuthNumber": "..."
  },
  "DocumentID": 333,
  "CustomerID": 222,
  "DocumentDownloadURL": "https://...",  // ⚠️ contains an unauthenticated download token
  "RecurringCustomerItemIDs": [444]
}
```

Failure shape — top-level `Status` is `"Failed"` (or another error string), `Data` may be `null`, and the human-readable reason lives in `UserErrorMessage` / `TechnicalErrorDetails`.

Both shapes flow through [`normalizeRecurringChargeResponse`](../src/index.ts) which produces a `NormalizedSumitEvent` with `ok: true | false | null`.

### Other recurring endpoints (not wrapped by this package)

| Endpoint | Purpose |
| --- | --- |
| `POST /billing/recurring/cancel/` | Cancel a customer recurring item. |
| `POST /billing/recurring/update/` | Update a customer recurring item (price, dates, qty). |
| `POST /billing/recurring/updatesettings/` | Update global recurring settings for the company. |
| `POST /billing/recurring/listforcustomer/` | List a customer's recurring items. |
| `POST /billing/payments/charge/` | One-off (non-recurring) charge. |
| `POST /billing/payments/list/` | List historical payments. |
| `POST /billing/payments/get/` | Fetch one payment by id. |
| `POST /billing/payments/beginredirect/` | Start a hosted-checkout redirect flow. |
| `POST /billing/paymentmethods/setforcustomer/` | Save a payment method for a customer. |
| `POST /billing/paymentmethods/getforcustomer/` | Fetch saved payment method. |
| `POST /billing/paymentmethods/remove/` | Remove a saved payment method. |

## Triggers (webhooks)

| Endpoint | Purpose |
| --- | --- |
| `POST /triggers/triggers/subscribe/` | Subscribe a webhook URL to a folder + view. Supports `TriggerType`: `CreateOrUpdate` / `Create` / `Update` / `Archive` / `Delete`. |
| `POST /triggers/triggers/unsubscribe/` | Unsubscribe a previously registered webhook. |

SUMIT Triggers are **not** Stripe-style — there is no fixed `EventType` envelope, and content-types vary:

- `application/json` — nested object resembling the charge response above.
- `application/x-www-form-urlencoded` — flat dotted keys like `Payment.Status=000&Payment.ValidPayment=true&RecurringCustomerItemIDs[0]=444`. Pass the request's `URLSearchParams` straight into `normalizeSumitIncomingPayload`.
- View / card-shaped payloads — no payment fields at all. These surface as `eventType: "sumit.trigger.unmapped"` with a sanitized `diagnostic` so the raw event can be safely persisted for later mapping.

### Recommended handler skeleton

```ts
import { normalizeSumitIncomingPayload, redactSumitPayload } from "@digitizers/sumit-api";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const raw = contentType.includes("application/x-www-form-urlencoded")
    ? new URLSearchParams(await request.text())
    : await request.json();

  const event = normalizeSumitIncomingPayload(raw);

  switch (event.eventType) {
    case "recurring.charged":
      // activate / extend the subscription using event.recurringItemId
      break;
    case "payment.failed":
      // notify, retry, or mark past_due — never re-log raw `raw`
      break;
    case "sumit.trigger.unmapped":
      // store redactSumitPayload(raw) for later inspection
      break;
  }

  return new Response("ok");
}
```

## Customer SearchMode

`Accounting_Typed_CustomerSearchMode` enum (numeric values in parens are the on-the-wire codes):

| Code | Mode               | Notes                                                 |
| ---- | ------------------ | ----------------------------------------------------- |
| 0    | Automatic          | SUMIT picks the field heuristically.                  |
| 1    | None               | Always create a new customer.                         |
| 2    | ExternalIdentifier | What this library uses — looks up by your stable id.  |
| 3    | Name               |                                                       |
| 4    | CompanyNumber      |                                                       |
| 5    | Phone              |                                                       |
| 6    | EmailAddress       |                                                       |

## Currency

`buildRecurringChargePayload` ships ILS / USD / EUR (the codes any Israeli SaaS realistically needs):

| Code | Currency |
| ---- | -------- |
| 0    | ILS      |
| 1    | USD      |
| 2    | EUR      |

The full SUMIT enum (`Accounting_Typed_DocumentCurrency`) supports ~150 codes (CAD=3, GBP=5, AUD=6, JPY=8, …). If you need one of them, build the payload object yourself — `currencyToSumitCode` will throw on unknown values, but `currencyFromSumitCode` already passes unknown codes through as a string when normalizing responses.

## Status codes

- `"000"` and `"0"` indicate a successful payment.
- Any other all-digit `Payment.Status` is treated as a failure.
- Non-numeric statuses are matched against an error-keyword regex (English + Hebrew + `Upay_*`).
- When `Payment.ValidPayment === false`, the event is always classified as `payment.failed` regardless of `Status`.

## Sensitive-field redaction

`redactSumitPayload(value)` walks the structure recursively and replaces matching keys with `"[REDACTED]"`. The current key allow-list (case-insensitive, anchored with `_` boundaries) covers every sensitive field in the swagger `PaymentMethod` schema:

- Auth/secrets: `APIKey`, `APIPublicKey`, `SingleUseToken`, generic `Token`, `Authorization`, `Secret`, `Password`
- Card data: `CVV`, `CardMask`, `CardPattern`, `CardToken`, `CardExpiration`, `CreditCard_*` (covers `_Number`, `_LastDigits`, `_Track2`, `_CVV`, `_CitizenID`, `_Token`, `_CardMask`, `_ExpirationMonth`, `_ExpirationYear`)
- Cardholder PII: `CardOwnerName`, `CardOwnerSocialId`, `CitizenID`
- Bank credentials: `DirectDebit_*` (Bank / Branch / Account / ExpirationDate / MaximumAmount)
- Other: `AuthNumber`, `EmailAddress`, `Phone`, `ResultRecord`, `DocumentDownloadURL`

`redactSensitiveText(text)` additionally scrubs:

- Email addresses
- `token=` / `apikey=` / `card=` style key/value substrings
- `Upay_*` provider error codes
- UUIDs
- Long card-like number runs (12–19 digits)
- 9-digit Israeli national IDs

> **Caution:** the redactor is an allow-list, not a deny-list. SUMIT can add fields at any time — review and extend `SENSITIVE_KEY_PATTERN` whenever a new field appears in your normalized events. Never log raw provider payloads.
