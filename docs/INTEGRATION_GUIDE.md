# SUMIT integration guide — recurring billing, trials, triggers & receipts

> Hard-won field notes for integrating SUMIT (OfficeGuy / Upay) recurring billing
> end-to-end: tokenisation → recurring charge with a real trial → the **view-shaped
> webhook trigger** → invoice → receipt PDF. SUMIT's docs are thin and its triggers
> are **not** Stripe-style; this captures what actually works in production.
> Companion to `API_REFERENCE.md`.

## TL;DR / gotcha index

1. **Auth is a `Credentials` body object** (`{ CompanyID, APIKey }`), **not** a
   `Bearer` header, for server endpoints (charge, getpdf, …). A few endpoints
   "work" with Bearer but several silently fail — always use `Credentials`.
2. **Tokenise with `OfficeGuy.Payments.CreateToken`** (programmatic, Promise),
   **never `BindFormSubmit`** — BindFormSubmit hijacks the form's native submit
   (GET `?og-token=…`) and bypasses your handler, so the token never reaches your
   server.
3. **A real free trial = `Items[].Date_Start`** (a future `YYYY-MM-DD`). The card
   is tokenised now but the first charge is deferred to that date. Omit it ⇒
   charged immediately.
4. **Triggers are NOT Stripe webhooks.** A trigger fires from a **view** and POSTs
   the **view record** (`{ Folder, EntityID, Type, Properties }`), not a charge
   payload, with **no `EventType`** and view-specific, ambiguous field names.
5. **The trigger URL carries the secret as `?secret=…`** — SUMIT triggers can't
   send custom headers. A **base64 secret breaks in the query** (its `+` decodes
   to a space). URL-encode it (`+`→`%2B`) or restore `space`→`+` server-side.
6. **`getpdf` returns the PDF *binary*** (`%PDF-…`), not a JSON URL. Stream it.
7. **Receipt language**: `DocumentLanguage` — Hebrew=0, **English=1**, Arabic=2,
   Spanish=3.
8. **SUMIT retries triggers**, so your idempotency gate must live **inside the same
   DB transaction** as the billing writes — otherwise a crash mid-write leaves the
   gate committed and the retry is rejected as a duplicate while the period never
   advanced (sub stuck `TRIALING` after a real charge). See §6.

---

## 1. Base URL, auth, currency

- REST base: `https://api.sumit.co.il`. All calls are `POST` JSON.
- Client tokenisation host: `https://app.sumit.co.il/scripts/payments.js`.
- **Server auth** — a `Credentials` object **in the body**:
  ```jsonc
  { "Credentials": { "CompanyID": 123, "APIKey": "***" } }
  ```
  `APIKey` is server-only. `APIPublicKey` is the browser key used by tokenisation.
  Do **not** rely on `Authorization: Bearer` — use `Credentials` everywhere.
- **Currency codes**: `ILS=0, USD=1, EUR=2`.
- **Customer `SearchMode`**: `2` = match by `ExternalIdentifier` (use your org id).
  This dedupes the *customer* across calls; it does **not** dedupe recurring items.

## 2. Client-side tokenisation

Load jQuery then `payments.js` (both `afterInteractive`; `beforeInteractive` is
only legal in a Next.js root layout). On submit, call **`CreateToken`
programmatically** and resolve the `SingleUseToken` via a Promise:

```ts
OfficeGuy.Payments.CreateToken({
  CompanyID, APIPublicKey,
  FormSelector: "#my-form",
  ResponseCallback: (r) => r.Status === 0 && r.Data?.SingleUseToken
    ? resolve(r.Data.SingleUseToken)
    : reject(new Error(r.UserErrorMessage ?? "tokenisation failed")),
});
```

The form holds `data-og` fields (`cardnumber`, `expirationmonth`,
`expirationyear`, `cvv`, `citizenid`). **Do not** use `BindFormSubmit`.

CSP for the checkout page must allow `https://*.sumit.co.il` in **`connect-src`**
(the tokenisation XHR hits `api.sumit.co.il`) and `script-src`.

## 3. Recurring charge + real trial — `POST /billing/recurring/charge/`

Charges the card **and** creates the standing order, returning identifiers
**synchronously** — so you record the subscription immediately; no webhook is
needed for "subscription created".

```jsonc
{
  "Credentials": { "CompanyID": 123, "APIKey": "***" },
  "Customer": {
    "ExternalIdentifier": "<your org id>",   // SearchMode 2 dedupes on this
    "SearchMode": 2,
    "Name": "<name for the receipt>",
    "EmailAddress": "<where receipts go>"
  },
  "SingleUseToken": "<from CreateToken>",
  "Items": [{
    "Item": { "Name": "Pro Plan", "Description": "monthly", "Duration_Months": 1 },
    "Quantity": 1,
    "UnitPrice": 99,
    "Currency": 1,
    "Duration_Months": 1,       // interval: 1=monthly, 12=yearly
    "Recurrence": 0,            // number of charges; 0/null = until cancelled
    "Date_Start": "2026-07-10" // FIRST charge date -> a real free trial
  }],
  "VATIncluded": true,
  "OnlyDocument": false,
  "DocumentLanguage": 1         // English receipts (default is company language)
}
```

- **`Date_Start`** (`YYYY-MM-DD`, defaults to today): the trial lever. Set it to
  `now + N days`; the card is tokenised now but **not charged until then**. Cancel
  before it ⇒ never charged. Store the same date as your `trialEndsAt`. Compute it
  in **UTC** (`setUTCDate`) so the `YYYY-MM-DD` you send matches your stored date
  regardless of server timezone.
- Success response carries `CustomerID` and `RecurringCustomerItemIDs[0]` (the
  recurring item id) — persist both. With a future `Date_Start` there is **no
  immediate Payment**; that's expected.
- **Idempotency**: the external POST has no idempotency key. If your DB
  transaction rolls back *after* SUMIT created the recurring item you get an
  orphaned standing order, and a retry creates a *second*. Guard by listing the
  customer's active recurring items first — see §6.

Related: `/billing/recurring/cancel/`, `/billing/recurring/update/`,
`/billing/recurring/listforcustomer/` (body: `Credentials`, `Customer`,
`IncludeInactive`; returns `Data.RecurringItems[]` with `ID`, `Date_NextBilling`,
`Status`).

## 4. ⚠️ Triggers / webhooks — the part nobody documents

SUMIT has **no Stripe-style webhooks**. You build a **Trigger** ("טריגר") on a
**View** ("תצוגה") of records (e.g. a view filtered to successful credit charges),
with the change-event **"create card"** ("יצירת כרטיס") and an **HTTP-call**
("קריאת HTTP") step pointing at your endpoint.

### 4a. Auth — secret in the URL (no headers)

SUMIT triggers **cannot send custom HTTP headers**. The only way to authenticate
is the **URL**:

```
https://your.app/api/billing/webhook?secret=<SUMIT_WEBHOOK_SECRET>
```

**Critical gotcha:** if `SUMIT_WEBHOOK_SECRET` is **base64** (contains `+` `/`
`=`), placing it raw in the query corrupts it — the URL parser decodes `+` to a
**space**, so the received value ≠ the stored value and every trigger is
**401-rejected** (and no invoice is ever created). Fixes:
- URL-encode the secret in the trigger URL (`+`→`%2B`, `/`→`%2F`, `=`→`%3D`), **or**
- use a URL-safe secret (`openssl rand -hex 32`), **or**
- on the server, also compare `querySecret.replace(/ /g, "+")` (restore the lost
  `+`). Always constant-time compare.

A correctly-authenticated trigger returns 2xx; SUMIT shows a **send history** per
record ("הסתיימה בהצלחה" / "ארעה שגיאה: Response status code…").

### 4b. Payload shape — the view record, not a charge

The trigger POSTs the **view record**, JSON like:

```jsonc
{
  "Folder": 98286376,
  "EntityID": 2060189353,      // the charge record's unique id
  "Type": "Create",
  "Properties": {
    // view-column field ids — names are MISLEADING:
    "Billing_PaymentMethod": [{ "ID": 2059741426, "Name": "Acme Org" }], // the CUSTOMER
    "Billing_PaymentSource": [{ "ID": 2059741429, "Name": "Pro Plan" }], // the product
    "Billing_CustomerItems": [{ "ID": 2059741428, "Name": "credit card …" }],
    "Billing_CurrencyEnum": [99.00],                                     // the AMOUNT
    "Billing_Amount": ["2026-06-27T14:52:22+03:00"],                     // the DATE
    "Property_M-1": [{ "ID": 2060189356, "Name": "Invoice/Receipt / 11040" }] // the DOCUMENT
  }
}
```

Notes:
- **No `EventType`** — you can't switch on an event name.
- The field **names are not semantic** (the customer sits under
  `Billing_PaymentMethod`, the amount under `Billing_CurrencyEnum`, the date under
  `Billing_Amount`). They are the *view's columns* and differ per view, so **do not
  trust them**.
- It may also arrive `application/x-www-form-urlencoded` with dotted keys
  (`Payment.Status=000`) / indexed arrays (`RecurringCustomerItemIDs[0]=444`) /
  a `json=<serialized>` envelope, depending on how the trigger is built.

### 4c. Robust mapping strategy

Don't parse by field name. Instead:

1. Parse content-type-aware (form → `URLSearchParams`, else JSON).
2. Run it through the normalizer (`normalizeSumitIncomingPayload`). Charge-shaped
   payloads infer `recurring.charged`/`payment.succeeded`/`payment.failed`;
   view-shaped ones come back `sumit.trigger.unmapped`.
3. For an unmapped **view record**, **collect every `ID`** in the payload
   (`EntityID` + each `Properties.*[].ID`) and **match against a known
   subscription** by `sumitCustomerId` **or** `sumitRecurringId`. A match ⇒ it's a
   real charge for that org ⇒ promote to `recurring.charged`:
   - **amount/currency from *your* subscription** (never the view's ambiguous
     fields),
   - **`EntityID`** = the unique per-charge id → use it as the invoice payment id
     **and** the idempotency key (so monthly renewals each process once),
   - document id / human number best-effort from the receipt-named object.
4. No id match ⇒ leave it unmapped (log + skip); never let an unauthenticated /
   unknown shape mutate billing state.

### 4d. Which events you actually need

| lifecycle stage | synchronous response? | trigger needed? |
|---|---|---|
| Subscribe (card entered, trial starts) | **yes** (CustomerID + RecurringItemID) | **no** |
| First charge at trial end, and each renewal | no (SUMIT's schedule) | **yes** → `recurring.charged` |
| Renewal **failed** | no | recommended → `payment.failed` (dunning) |
| Cancellation initiated **in your app** | you call `recurring/cancel/` | **no** |
| Cancellation initiated **in SUMIT** | only a trigger would tell you | only if that can happen |

So the **one required trigger is the successful-recurring-charge view**. Skip
"subscription created" (synchronous) and "cancellation" if cancels only originate
in your app.

**Cancellation model — make your app the source of truth.** Don't depend on a
`recurring.cancelled` trigger (it may arrive view-shaped with no `EventType` and
normalize to unmapped). Instead:

- **App-initiated cancel:** call `recurring/cancel/` **and** update your DB in the
  same request — synchronous, no trigger needed. Any echo trigger is redundant;
  guard your handler so it doesn't downgrade a `cancelAtPeriodEnd` sub before its
  period actually ends.
- **SUMIT-autonomous cancel** (standing order dropped after repeated failed
  charges, mandate/card revoked): you don't need the cancel trigger to catch it —
  the failed charge already fires `payment.failed` → your dunning flips to
  `PAST_DUE` → grace cron downgrades. Dunning drives it even if SUMIT stays silent.
- **Out-of-band cancel in the SUMIT portal** is the only unobservable path → make
  it an ops rule: *never cancel a standing order directly in SUMIT; always cancel
  through the app.*

## 5. Receipt / invoice PDF — `POST /accounting/documents/getpdf/`

Request: `{ Credentials, DocumentID, DocumentType?, DocumentNumber?, Original? }`.
**The response is the PDF *binary*** (starts with `%PDF`), **not** JSON with a
URL. Stream it back:

```ts
const buf = await res.arrayBuffer();
const isPdf = new TextDecoder().decode(buf.slice(0, 5)).startsWith("%PDF");
// isPdf -> return with Content-Type application/pdf (+ Content-Disposition
//          attachment to download instead of opening a tab)
// else  -> it's a JSON error envelope: parse UserErrorMessage/TechnicalErrorDetails
```

## 6. Hardening notes from production

- **Duplicate standing orders**: before `recurring/charge/`, call
  `recurring/listforcustomer/` (by `ExternalIdentifier`) and bail if an item has a
  future `Date_NextBilling` (a live order) but you have no subscription row — an
  orphan from a rolled-back attempt. Fail **open** (allow checkout on any error).
- **Idempotency gate**: dedupe on `(provider, eventId)` where `eventId` is derived
  from the charge's unique id (`EntityID` / `PaymentID`). Derive it **after** the
  view→charge promotion so each charge's unique id is used (else all unmapped
  triggers collapse to one key and only the first processes).
- **Transactional idempotency — put the gate INSIDE the transaction.** SUMIT
  retries any trigger that didn't return 2xx. If you commit the gate row first and
  *then* do the billing writes (invoice + advance the subscription) as separate
  statements, a crash between them is unrecoverable: the gate is already committed,
  so the retry is rejected as a **duplicate**, yet the period never advanced — the
  sub is stuck `TRIALING` after a **real** charge (and a dunning cron may then drop
  the paying customer to FREE). Wrap the gate `create` **and** every billing write
  in **one DB transaction**. A failed attempt rolls the gate back with the work, so
  the retry reprocesses cleanly; an already-committed event still short-circuits on
  the unique constraint. Do **not** instead "reprocess when processedAt is null" —
  the period-advance (`currentPeriodEnd += interval`) is not idempotent and would
  double-advance.
- **Trial-conversion safety net**: a cron that flips a `TRIALING` sub past its
  trial end to `PAST_DUE` *only if* no PAID invoice exists, with a ~2-day grace to
  absorb charge-settlement + trigger lag — and re-check for a current-period PAID
  invoice immediately before any destructive downgrade, so a late trigger never
  drops a paying customer.
- **Period-end cancel**: cancelling the SUMIT recurring stops renewals
  immediately; add a finalizer that flips `cancelAtPeriodEnd` subs to
  CANCELED/FREE at period end, and don't let a `recurring.cancelled` echo downgrade
  a still-in-period sub early.
- **Verification has three modes**: HMAC `x-sumit-signature` over the raw body,
  `x-webhook-secret` header, or `?secret=` query. Triggers can only do the query
  form (see §4a). Fail **closed** in production when the secret is unset.

## 7. Reference timeline of failure modes (so you recognise them)

| symptom | cause | fix |
|---|---|---|
| `?og-token=…` in the URL, no charge | `BindFormSubmit` | `CreateToken` |
| tokenisation XHR blocked | CSP `connect-src` missing `*.sumit.co.il` | add it |
| card charged on day 0 despite "trial" | no `Date_Start` sent | send `Date_Start` |
| every trigger `401 missing or invalid signature` | base64 secret `+`→space in `?secret=` | URL-encode / restore `+` |
| trigger `200` but no invoice; log "Unmapped trigger" | view-shaped payload, no `EventType` | id-match promotion (§4c) |
| sub stuck `TRIALING` after a real charge; retry says "duplicate" | idempotency gate committed before the billing writes; crash between them | gate `create` inside the same transaction as the writes (§6) |
| PDF: `Unexpected token '%' … not valid JSON` | `getpdf` returns the PDF binary | stream `arrayBuffer()` |
| receipts in Hebrew | default company language | `DocumentLanguage: 1` |
