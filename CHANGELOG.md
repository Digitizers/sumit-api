# Changelog

All notable changes to this package are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- `redactSensitiveText` no longer takes quadratic time on a long run of email-local-part characters with no `@` (CodeQL `js/polynomial-redos`). The email pattern now starts a match only at the beginning of a run. 50,000 `+` characters took about 1.6 s before; now well under the test's 500 ms bound. Output is unchanged.
- CI runs with `contents: read` only (CodeQL `actions/missing-workflow-permissions`).

## [0.5.0] - 2026-10-12

### Changed

- **Breaking:** `vatIncluded` is now required in `buildOneOffChargePayload`, `buildRecurringChargePayload` and `buildCreateDocumentPayload`, and the builders throw when it is not a boolean. Before, an omitted flag was sent as `VATIncluded: true`, the opposite of SUMIT's own default (its published schema: "Leave empty for false"). A caller that followed SUMIT's documentation, passed net prices and left the flag out got a document or a charge whose total left the VAT out, with no error. To keep the previous behaviour, pass `vatIncluded: true`; if your prices are net, pass `vatIncluded: false`.
- **Breaking:** `buildCreateDocumentPayload` sends `Details.Customer.ID` as a number, as SUMIT's schema types it (`int64`), and throws when `customer.id` is not a positive integer. `customer.id` accepts `number | string`; a numeric string is converted. Before, the value was sent as whatever string the caller passed.

### Added

- `SUMIT_CUSTOMER_SEARCH_MODE` and the exported type `SumitCustomerSearchMode`, covering all seven values of SUMIT's `Accounting_Typed_CustomerSearchMode`. `customer.searchMode` was typed `0 | 1 | 2`, so search by name, company number, phone or email could not be requested.

### Fixed

- The comments and docs on the customer search mode described mode 0 as "create new" and as "match by ID only", and mode 1 as "always create new customer". Per SUMIT's schema they are `Automatic` and `None`. The values the builder derives are unchanged.

## [0.4.1] - 2026-07-03

### Fixed

- `normalizeSumitIncomingPayload` no longer throws on urlencoded payloads that contain an empty key (e.g. `=x`) — malformed or hostile form input falls through to normal handling instead of a `TypeError`.
- `redactSensitiveText` masks processor codes as `Upay_[REDACTED]` instead of `[REDACTED]`, so failure classification keeps seeing the processor signal after redaction. Responses whose only failure indicator is an `Upay_*` code surface as `payment.failed` again instead of `sumit.trigger.unmapped`.
- `buildCreateDocumentPayload` derives `SearchMode` from the blank-stripped customer identifiers — a whitespace-only `id` no longer selects search-by-ID while `ID` is omitted from the payload, which skipped a valid `ExternalIdentifier` upsert.

### Documentation

- README documents that the create-document builder never sends `Payments` rows, so payment-bearing document types (`Receipt`, `InvoiceAndReceipt`) should be issued via the charge endpoints or the SUMIT UI.

## [0.4.0] - 2026-06-26

### Added

- `RecurringChargeItem.dateStart` → emits `Items[].Date_Start` (SUMIT "First payment date", `YYYY-MM-DD`). Set it in the future to defer the first charge: the card is tokenised immediately but not charged until then, enabling a real free trial. Omitted ⇒ charged today (unchanged behaviour).

## [0.3.1] - 2026-05-14

### Fixed

- `buildCreateDocumentPayload` no longer emits `Payments: []` — SUMIT rejected document-create requests that included an empty `Payments` array.
- `Details.Language` is now sent as the numeric enum SUMIT requires (`Accounting_Typed_Language`: Hebrew=0, English=1, Arabic=2, Spanish=3) rather than the literal `"he"`/`"en"` string that returned `Details.Language: Error converting value "he"` from SUMIT.
- `Customer.SearchMode` is now derived automatically: SUMIT id ⇒ `1`, ExternalIdentifier ⇒ `2`, otherwise `0`. Previously every request hardcoded `0`, which prevented customer upserts.
- Empty / whitespace-only optional fields (`emailAddress`, `phone`, `taxId`, item `description`, `sku`, etc.) are now stripped rather than sent as `""` — SUMIT rejects empty strings on several optional fields.

### Added

- `SUMIT_DOCUMENT_TYPE` now exposes the full `Accounting_Typed_DocumentType` enum: `Invoice` (0), `InvoiceAndReceipt` (1), `Receipt` (2), `ProformaInvoice` (3), `PriceQuotation` (12), and all credit/expense variants.
- `SUMIT_LANGUAGE` const exposing `Hebrew=0`, `English=1`, `Arabic=2`, `Spanish=3`.
- `language` / `responseLanguage` params accept the shorthand strings `"he"`/`"en"`/`"ar"`/`"es"` (and full English names) in addition to numeric codes.

### Changed

- `SumitNormalizedEventType` and supporting types unchanged.
- `SUMIT_DOCUMENT_TYPE.TransactionInvoice` is retained as a deprecated alias to `1` for backwards compatibility, but **its meaning was wrong in 0.3.0** — code `1` is `InvoiceAndReceipt` (חשבונית מס-קבלה), not the pre-payment "חשבון עסקה". Use `SUMIT_DOCUMENT_TYPE.ProformaInvoice` (3) for חשבון עסקה.

## [0.3.0] - 2026-05-13

### Added

- `buildCreateDocumentPayload(params)` — builder for `POST /accounting/documents/create/`. Issues SUMIT accounting documents (חשבון עסקה / חשבונית מס / חשבונית מס-קבלה / קבלה) without charging a card.
- `normalizeCreateDocumentResponse(response)` — surfaces successful creates as `eventType: "document.created"` with `documentId`, `documentNumber`, `documentDownloadUrl`, `customerId`. Failures surface as `eventType: "document.failed"`.
- `SUMIT_DOCUMENT_TYPE` const exposing `TransactionInvoice = 1`. Other SUMIT document type codes can be passed directly as numbers.
- `currencyToSumitString(currency)` helper — the documents endpoint takes literal `"ILS"`/`"USD"`/`"EUR"` strings rather than the numeric codes used by the charge endpoints.
- `documentNumber` and `documentDownloadUrl` fields on `NormalizedSumitEvent`.
- Type exports: `BuildCreateDocumentPayloadParams`, `SumitCreateDocumentPayload`, `CreateDocumentItem`, `CreateDocumentCustomer`, `CreateDocumentSendByEmail`.

### Changed

- `SumitNormalizedEventType` adds `"document.created"` and `"document.failed"`.
- README and API reference document the new endpoint and helpers.

## [0.2.0] - 2026-05-02

### Added

- `buildOneOffChargePayload(params)` — builder for `POST /billing/payments/charge/`. Items omit the recurring-only `Duration_Months` and `Recurrence` fields.
- `normalizeChargeResponse(response)` — exported as the canonical normalizer for both one-off and recurring charge responses. The same logic surfaces `eventType: "recurring.charged"` only when SUMIT returns a `RecurringCustomerItemIDs[*]`.
- Type exports: `BuildOneOffChargePayloadParams`, `SumitOneOffChargePayload`, `OneOffChargeItem`, `RecurringChargeItem`.

### Changed

- README and API reference document the new one-off endpoint and the dual-mode normalizer.

### Notes

- `normalizeRecurringChargeResponse` remains exported as an alias for `normalizeChargeResponse` — no breaking change.

## [0.1.0] - 2026-05-01

### Added

- Initial release.
- `buildRecurringChargePayload`, `normalizeRecurringChargeResponse`, `normalizeSumitIncomingPayload`, `redactSumitPayload`, `currencyToSumitCode`, `currencyFromSumitCode`.
- Two-layer redaction (key-based `SENSITIVE_KEY_PATTERN` + text-based `redactSensitiveText`).
- Prototype-pollution guard in form-encoded payload parsing.
