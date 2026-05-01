# Changelog

All notable changes to this package are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
