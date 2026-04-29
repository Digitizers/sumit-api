# SUMIT API Reference

This package wraps a small slice of the SUMIT / OfficeGuy / Upay billing API. It does **not** ship a transport client — `fetch` is the integrator's responsibility. The helpers here build the request body, normalize responses, and redact sensitive fields before logging.

## Official documentation

- REST API portal: https://app.sumit.co.il/developers/api/
- Swagger / OpenAPI explorer: https://app.sumit.co.il/help/developers/swagger/index.html

Both pages are gated behind the SUMIT customer portal — sign in with a SUMIT account to see the live schemas, sample payloads, and per-endpoint authentication requirements.

## Authentication

All write endpoints use a JSON `Credentials` object on the request body:

```jsonc
{
  "Credentials": {
    "CompanyID": 123,        // numeric SUMIT company id
    "APIKey": "<server>"     // private key — server-side only
    // "APIPublicKey": "..." // public key — used by the browser checkout SDK
  }
}
```

- `APIKey` is a **server-side secret**. Never ship it to the browser.
- `APIPublicKey` is intended for the in-browser tokenization step that produces a `SingleUseToken`.
- Treat `SingleUseToken` as one-shot — it is consumed by the first charge attempt.

## Endpoints covered by this package

### `POST /billing/recurring/charge/`

Charges a customer using a `SingleUseToken` produced by the browser checkout SDK and creates the recurring item if it does not already exist.

**Request body** — built by [`buildRecurringChargePayload`](../src/index.ts):

```ts
{
  Credentials: { CompanyID, APIKey },
  Customer: {
    ExternalIdentifier: string,
    SearchMode: 2,            // 2 = lookup-or-create by ExternalIdentifier
    Name: string,
    EmailAddress: string,
  },
  SingleUseToken: string,
  Items: [{
    Item: { Name, Description, Duration_Months },
    Quantity: number,
    UnitPrice: number,
    Currency: 0 | 1 | 2,      // 0=ILS, 1=USD, 2=EUR
    Duration_Months: number,  // duplicated at item-parent level by SUMIT convention
    Recurrence: number,       // 0 = use SUMIT default cadence
  }],
  VATIncluded: boolean,
  OnlyDocument: boolean,
  AuthoriseOnly?: true,       // omit unless capturing a $0/auth-only attempt
}
```

**Successful response shape** observed in production smoke tests:

```jsonc
{
  "Payment": {
    "ID": 111,
    "CustomerID": 222,
    "Date": "2026-04-29T17:46:17+03:00",
    "ValidPayment": true,
    "Status": "000",                    // "000" / "0" indicate success
    "StatusDescription": "מאושר (קוד 000)",
    "Amount": 1,
    "Currency": 1
  },
  "DocumentID": 333,
  "CustomerID": 222,
  "RecurringCustomerItemIDs": [444]
}
```

**Failed response shape**:

```jsonc
{
  "Status": "Failed",
  "UserErrorMessage": "Payment failed",
  "TechnicalErrorDetails": "הסכום נמוך מדי... (קוד Upay_30001419)",
  "Data": null
}
```

Both shapes flow through [`normalizeRecurringChargeResponse`](../src/index.ts) which produces a `NormalizedSumitEvent` with `ok: true | false | null`.

## Trigger / Webhook payloads

SUMIT Triggers are configured per-event in the SUMIT admin and POSTed to your endpoint. They are **not** Stripe-style — there is no fixed `EventType` envelope, and content-types vary:

- `application/json` — nested object resembling the charge response above.
- `application/x-www-form-urlencoded` — flat dotted keys like `Payment.Status=000&Payment.ValidPayment=true`. Pass the request's `URLSearchParams` straight into `normalizeSumitIncomingPayload`.
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

## Currency codes

| Code | Currency |
| ---- | -------- |
| 0    | ILS      |
| 1    | USD      |
| 2    | EUR      |

`currencyToSumitCode` and `currencyFromSumitCode` translate between the numeric SUMIT codes and ISO strings.

## Status codes

- `"000"` and `"0"` indicate success.
- Any other all-digit `Status` value is treated as a failure.
- Non-numeric statuses are matched against an error-keyword regex (English + Hebrew + `Upay_*`).

When the response body has `Payment.ValidPayment === false`, the event is always classified as `payment.failed` regardless of `Status`.

## Sensitive-field redaction

`redactSumitPayload(value)` walks the structure recursively and replaces matching keys with `"[REDACTED]"`. The current key allow-list (case-insensitive, anchored with `_` boundaries) covers:

- `APIKey`, `APIPublicKey`, `SingleUseToken`, generic `Token`
- `Authorization`, `Secret`, `Password`
- Card fields: `CVV`, `CardMask`, `CardPattern`, `CardToken`, `CardExpiration`, `CreditCard_*`
- `AuthNumber`, `EmailAddress`, `Phone`, `CitizenID`
- `ResultRecord`, `DocumentDownloadURL`

`redactSensitiveText(text)` additionally scrubs:

- Email addresses
- `token=` / `apikey=` / `card=` style key/value substrings
- UUIDs
- Long card-like number runs (12–19 digits)

> **Caution:** the redactor is an allow-list, not a deny-list. SUMIT can add fields at any time — review and extend `SENSITIVE_KEY_PATTERN` whenever a new field appears in your normalized events. Never log raw provider payloads.
