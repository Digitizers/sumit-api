# CLAUDE.md

Guidance for AI assistants working in this repository.

## Project

`sumit-api` — pure TypeScript helpers for SUMIT / OfficeGuy / Upay recurring billing and trigger webhooks. **Zero runtime dependencies.** Single-file source: [`src/index.ts`](src/index.ts).

Companion package: [`sumit-react`](https://github.com/Digitizers/sumit-react).

## Public surface

Only these exports are stable:

- `buildRecurringChargePayload(params)` — assembles the `/billing/recurring/charge/` request body.
- `normalizeRecurringChargeResponse(response)` / `normalizeSumitIncomingPayload(payload)` — collapse the three SUMIT response shapes (JSON, urlencoded, `json=…` envelope) into a single `NormalizedSumitEvent`.
- `redactSumitPayload(payload)` — recursive redactor for logs.
- `currencyToSumitCode` / `currencyFromSumitCode`.

Everything else (helpers, regexes, parsing internals) is private. Don't widen the surface without a reason.

## Conventions

- **No runtime dependencies.** Don't add any. Use Web Standards (`URLSearchParams`, `URL`, `Response`).
- **Strict TypeScript.** No `any`. Discriminated unions over enums. `compact(...)` to strip `undefined` keys before returning.
- **Comments only explain WHY.** Don't restate what the code does.
- **Tests are colocated** in [`src/index.test.ts`](src/index.test.ts) using Vitest. New behavior gets a test.

## Security model

This package handles payment data. Two non-negotiable rules:

1. **Never log raw payloads.** Always pipe through `redactSumitPayload` first. The `SENSITIVE_KEY_PATTERN` and `redactSensitiveText` together implement defense-in-depth (key-based + text-based redaction).
2. **Form parsing is hostile-input territory.** `formToNestedObject` rejects keys that traverse the prototype chain (`__proto__`, `constructor`, `prototype`). Don't remove that guard.

When extending redaction, prefer adding keys to `SENSITIVE_KEY_PATTERN` over adding broad text regexes — the latter cause false positives in diagnostic strings.

## Workflow

```bash
pnpm install
pnpm test         # vitest run — must pass before commit
pnpm typecheck    # tsc --noEmit
pnpm build        # tsc → dist/
```

Branches: `fix/*`, `feat/*`, `chore/*`. PRs to `main`. Conventional-commit-ish messages.
