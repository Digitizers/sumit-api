# SUMIT API Reference

This package wraps a small slice of the SUMIT (formerly OfficeGuy) billing API. SUMIT routes card clearing through partner processors — Upay is one of them — and their error codes (e.g. `Upay_30001419`) surface inside SUMIT response bodies, which is why this package redacts them by default. It does **not** ship a transport client — `fetch` is the integrator's responsibility. The helpers here build request bodies, normalize responses, and redact sensitive fields before logging or persistence.

## Official sources

- REST portal: <https://app.sumit.co.il/developers/api/>
- Swagger UI: <https://app.sumit.co.il/help/developers/swagger/index.html>
- Raw OpenAPI 3.1 spec: <https://app.sumit.co.il/swagger/v1/swagger.json>

## Base URL

```text
https://api.sumit.co.il
```

All API calls observed for these flows are `POST` with a JSON body and JSON response.

## Authentication

Every server-side request includes a `Credentials` object in the body:

```jsonc
{
  "Credentials": {
    "CompanyID": 123,
    "APIKey": "***"
  }
}
```

- `APIKey` is a server-side secret. Never ship it to the browser.
- `APIPublicKey` is a separate browser-side key used by SUMIT tokenization to produce a one-shot `SingleUseToken`.
- Treat `SingleUseToken` as sensitive and one-use.

## Standard response envelope

SUMIT endpoints often return an outer wrapper:

```jsonc
{
  "Status": "Success",
  "UserErrorMessage": null,
  "TechnicalErrorDetails": null,
  "Data": { /* endpoint-specific payload */ }
}
```

The outer `Status` is the framework-level response status, not the payment status code. Payment approval codes live on `Data.Payment.Status` or `Payment.Status`. Trigger payloads can flatten `Data` to the top level; the normalizer checks both shapes.

## `POST /billing/recurring/charge/`

Charges a customer and creates/updates a recurring item.

Built by `buildRecurringChargePayload`:

```ts
{
  Credentials: { CompanyID, APIKey },
  Customer: {
    ExternalIdentifier: string,
    SearchMode: 2,
    Name: string,
    EmailAddress: string,
  },
  SingleUseToken: string,
  Items: [{
    Item: { Name, Description, Duration_Months },
    Quantity: number,
    UnitPrice: number,
    Currency: 0 | 1 | 2,
    Duration_Months: number,
    Recurrence: number,
  }],
  VATIncluded: boolean,
  OnlyDocument: boolean,
  AuthoriseOnly?: true,
}
```

Notes:

- `SearchMode: 2` means lookup by `ExternalIdentifier`.
- `Currency`: `0=ILS`, `1=USD`, `2=EUR`.
- `VATIncluded` is a product decision. If true, the submitted price is gross/total; if false, SUMIT can add VAT on top.
- `AuthoriseOnly: true` is useful for integration sanity checks, but it is not proof of a live recurring subscription.

Successful payloads observed in smoke tests include `Payment.ValidPayment === true`, `Payment.Status === "000"`, `Payment.ID`, `CustomerID`, `DocumentID`, and `RecurringCustomerItemIDs[0]`.

## Related endpoints not wrapped directly

| Endpoint | Purpose |
| --- | --- |
| `POST /billing/recurring/cancel/` | Cancel a recurring item. |
| `POST /billing/recurring/update/` | Update a recurring item. |
| `POST /billing/recurring/listforcustomer/` | List customer recurring items. |
| `POST /billing/payments/charge/` | One-off charge. |
| `POST /billing/payments/list/` | List historical payments. |
| `POST /billing/payments/get/` | Fetch one payment. |
| `POST /billing/payments/beginredirect/` | Start hosted/redirect checkout. |
| `POST /billing/paymentmethods/setforcustomer/` | Save payment method for customer. |
| `POST /billing/paymentmethods/getforcustomer/` | Fetch saved payment method. |
| `POST /billing/paymentmethods/remove/` | Remove saved payment method. |

## Triggers / webhooks

SUMIT Triggers are not Stripe-style. They are configured around folders/views/actions and can send JSON or form-encoded payloads.

Common shapes:

- JSON charge-like payloads.
- `application/x-www-form-urlencoded` with dotted keys, e.g. `Payment.Status=000`.
- Indexed form arrays, e.g. `RecurringCustomerItemIDs[0]=444`.
- View/card-shaped payloads with `Folder`, `EntityID`, `Type`, and `Properties`.
- Form payloads shaped as `json=<serialized object>`.

Pass JSON objects or `URLSearchParams` into `normalizeSumitIncomingPayload`.

View-shaped triggers still normalize as `eventType: "sumit.trigger.unmapped"` unless the application explicitly authenticates and promotes them to trusted lifecycle events. This package extracts safe reconciliation fields where possible, but app code must decide whether the payload is allowed to mutate billing state.

## Customer SearchMode

| Code | Mode | Notes |
| --- | --- | --- |
| 0 | Automatic | SUMIT chooses heuristically. |
| 1 | None | Always create new customer. |
| 2 | ExternalIdentifier | Used by this library. |
| 3 | Name | Lookup by name. |
| 4 | CompanyNumber | Lookup by company number. |
| 5 | Phone | Lookup by phone. |
| 6 | EmailAddress | Lookup by email. |

## Currency

| Code | Currency |
| --- | --- |
| 0 | ILS |
| 1 | USD |
| 2 | EUR |

`currencyToSumitCode` accepts only ILS/USD/EUR. `currencyFromSumitCode` preserves unknown codes as strings when normalizing provider responses.

## Status codes

- `"000"` and `"0"` indicate successful payment.
- Any other all-digit `Payment.Status` is treated as failure.
- `Payment.ValidPayment === false` is always failure.
- Non-numeric statuses are matched against English/Hebrew error keywords and `Upay_*` signals.

## Sensitive-field redaction

`redactSumitPayload(value)` walks recursively and replaces sensitive keys with `[REDACTED]`. Covered categories include:

- Auth/secrets: `APIKey`, `APIPublicKey`, `SingleUseToken`, generic `Token`, `Authorization`, `Secret`, `Password`.
- Card data: `CVV`, `CardMask`, `CardPattern`, `CardToken`, `CardExpiration`, `CreditCard_*`.
- Cardholder PII: `CardOwnerName`, `CardOwnerSocialId`, `CitizenID`.
- Bank credentials: `DirectDebit_*`.
- Other: `AuthNumber`, `EmailAddress`, `Phone`, `ResultRecord`, `DocumentDownloadURL`.

`redactSensitiveText(text)` additionally scrubs emails, token/key/card key-value fragments, payment-method last-four labels, UUIDs, long card-like number runs, 9-digit Israeli IDs, and `Upay_*` provider error codes.

The redactor is a safety net, not permission to log raw provider payloads. Prefer storing normalized fields plus redacted diagnostics only.
