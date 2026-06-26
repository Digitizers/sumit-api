# Changelog

All notable changes to this package are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
