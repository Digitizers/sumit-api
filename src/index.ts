export type SumitCurrency = "ILS" | "USD" | "EUR" | 0 | 1 | 2;
export type SumitNormalizedEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "recurring.charged"
  | "recurring.cancelled"
  | "invoice.created"
  | "document.created"
  | "document.failed"
  | "sumit.trigger.unmapped";

// Known SUMIT document type codes. `TransactionInvoice` (1) is the
// pre-payment "חשבון עסקה". Other numeric codes (tax invoice, receipt,
// tax-invoice-receipt, etc.) accepted by SUMIT can be passed as plain
// numbers — this object only lists values we have actively verified.
export const SUMIT_DOCUMENT_TYPE = {
  TransactionInvoice: 1,
} as const;

export interface SumitDiagnostic {
  hasData: boolean;
  dataKeys: string[];
  hasCustomerID: boolean;
  recurringItemCount: number;
  userErrorMessage?: string;
  technicalErrorDetails?: string;
}

interface BaseChargeParams {
  companyId: number;
  apiKey: string;
  customer: {
    externalIdentifier: string;
    name: string;
    emailAddress: string;
  };
  singleUseToken: string;
  vatIncluded?: boolean;
  onlyDocument?: boolean;
  authoriseOnly?: boolean;
}

export interface OneOffChargeItem {
  name: string;
  description: string;
  quantity?: number;
  unitPrice: number;
  currency: SumitCurrency;
}

export interface RecurringChargeItem extends OneOffChargeItem {
  durationMonths: number;
  recurrence?: number;
}

export interface BuildOneOffChargePayloadParams extends BaseChargeParams {
  item: OneOffChargeItem;
}

export interface BuildRecurringChargePayloadParams extends BaseChargeParams {
  item: RecurringChargeItem;
}

interface BaseChargePayload {
  Credentials: {
    CompanyID: number;
    APIKey: string;
  };
  Customer: {
    ExternalIdentifier: string;
    SearchMode: 2;
    Name: string;
    EmailAddress: string;
  };
  SingleUseToken: string;
  VATIncluded: boolean;
  OnlyDocument: boolean;
  AuthoriseOnly?: true;
}

export interface SumitOneOffChargePayload extends BaseChargePayload {
  Items: Array<{
    Item: {
      Name: string;
      Description: string;
    };
    Quantity: number;
    UnitPrice: number;
    Currency: 0 | 1 | 2;
  }>;
}

export interface SumitRecurringChargePayload extends BaseChargePayload {
  Items: Array<{
    Item: {
      Name: string;
      Description: string;
      Duration_Months: number;
    };
    Quantity: number;
    UnitPrice: number;
    Currency: 0 | 1 | 2;
    Duration_Months: number;
    Recurrence: number;
  }>;
}

export interface NormalizedSumitEvent {
  ok: boolean | null;
  eventType: SumitNormalizedEventType;
  paymentId?: string;
  customerId?: string;
  documentId?: string;
  documentNumber?: string;
  documentDownloadUrl?: string;
  recurringItemId?: string;
  amount?: number;
  currency?: "ILS" | "USD" | "EUR" | string;
  status?: string;
  statusDescription?: string;
  occurredAt?: string;
  userErrorMessage?: string;
  technicalErrorDetails?: string;
  diagnostic?: SumitDiagnostic;
}

export interface CreateDocumentItem {
  name: string;
  description?: string;
  unitPrice: number;
  quantity?: number;
  // Optional override; defaults to unitPrice * quantity.
  totalPrice?: number;
  // Optional explicit per-line VAT amount.
  vat?: number;
  sku?: string;
  externalIdentifier?: string;
}

export interface CreateDocumentCustomer {
  name: string;
  emailAddress?: string;
  phone?: string;
  externalIdentifier?: string;
  // SUMIT internal customer ID (when known).
  id?: string;
  // Mapped to CompanyNumber — Israeli ת.ז. / ח.פ.
  taxId?: string;
  address?: string;
  city?: string;
  zipCode?: string;
  noVAT?: boolean;
  // SUMIT customer search mode. 0 = match by ID only (default for this endpoint),
  // 2 = upsert by ExternalIdentifier (matches the charge endpoints).
  searchMode?: 0 | 1 | 2;
}

export interface CreateDocumentSendByEmail {
  emailAddress: string;
  original?: boolean;
  sendAsPaymentRequest?: boolean;
}

export interface BuildCreateDocumentPayloadParams {
  companyId: number;
  apiKey: string;
  // SUMIT document type code. Use SUMIT_DOCUMENT_TYPE.TransactionInvoice (1)
  // for חשבון עסקה. Other codes from SUMIT's enum can be passed as plain numbers.
  documentType: number;
  customer: CreateDocumentCustomer;
  items: CreateDocumentItem[];
  // Defaults to "ILS". Accepts the same shape as the charge endpoints but
  // SUMIT documents take the literal string code, not the numeric one.
  currency?: SumitCurrency;
  // Whether the UnitPrice values already include VAT. Defaults to true to
  // match SUMIT's API default; pass false if your items are net.
  vatIncluded?: boolean;
  vatPerItem?: boolean;
  vatRate?: number;
  language?: string;
  description?: string;
  externalReference?: string;
  date?: string;
  dueDate?: string;
  sendByEmail?: CreateDocumentSendByEmail;
  isDraft?: boolean;
  responseLanguage?: string;
}

type SumitCustomerSearchMode = 0 | 1 | 2;

export interface SumitCreateDocumentPayload {
  Credentials: { CompanyID: number; APIKey: string };
  Details: {
    Type: number;
    Customer: {
      SearchMode: SumitCustomerSearchMode;
      Name: string;
      EmailAddress?: string;
      Phone?: string;
      ExternalIdentifier?: string;
      ID?: string;
      CompanyNumber?: string;
      Address?: string;
      City?: string;
      ZipCode?: string;
      NoVAT?: boolean;
    };
    SendByEmail?: {
      EmailAddress: string;
      Original: boolean;
      SendAsPaymentRequest: boolean;
    };
    Language?: string;
    Currency?: "ILS" | "USD" | "EUR" | string;
    Description?: string;
    ExternalReference?: string;
    Date?: string;
    DueDate?: string;
    IsDraft?: boolean;
  };
  Items: Array<{
    Quantity: number;
    UnitPrice: number;
    TotalPrice: number;
    VAT?: number;
    Item: {
      Name: string;
      Description?: string;
      SKU?: string;
      ExternalIdentifier?: string;
      SearchMode: SumitCustomerSearchMode;
    };
  }>;
  Payments: never[];
  VATIncluded: boolean;
  VATPerItem?: boolean;
  VATRate?: number;
  ResponseLanguage?: string;
}

type UnknownRecord = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN = /(^|_)(api(public)?key|singleusetoken|token|authorization|secret|password|cvv|citizenid|card(mask|pattern|token|expiration)?|cardowner(name|socialid)?|creditcard(_.*)?|directdebit(_.*)?|authnumber|emailaddress|phone|resultrecord|documentdownloadurl)$/i;

export function currencyToSumitCode(currency: SumitCurrency): 0 | 1 | 2 {
  if (currency === 0 || currency === "ILS") return 0;
  if (currency === 1 || currency === "USD") return 1;
  if (currency === 2 || currency === "EUR") return 2;
  throw new Error(`Unsupported SUMIT currency: ${String(currency)}`);
}

export function currencyToSumitString(currency: SumitCurrency): "ILS" | "USD" | "EUR" {
  const code = currencyToSumitCode(currency);
  return code === 0 ? "ILS" : code === 1 ? "USD" : "EUR";
}

export function currencyFromSumitCode(currency: unknown): "ILS" | "USD" | "EUR" | string | undefined {
  if (currency === 0 || currency === "0" || currency === "ILS") return "ILS";
  if (currency === 1 || currency === "1" || currency === "USD") return "USD";
  if (currency === 2 || currency === "2" || currency === "EUR") return "EUR";
  if (currency == null || currency === "") return undefined;
  return String(currency);
}

export function buildOneOffChargePayload(params: BuildOneOffChargePayloadParams): SumitOneOffChargePayload {
  return {
    ...baseChargeEnvelope(params),
    Items: [
      {
        Item: {
          Name: params.item.name,
          Description: params.item.description,
        },
        Quantity: params.item.quantity ?? 1,
        UnitPrice: params.item.unitPrice,
        Currency: currencyToSumitCode(params.item.currency),
      },
    ],
  };
}

export function buildRecurringChargePayload(params: BuildRecurringChargePayloadParams): SumitRecurringChargePayload {
  return {
    ...baseChargeEnvelope(params),
    Items: [
      {
        Item: {
          Name: params.item.name,
          Description: params.item.description,
          Duration_Months: params.item.durationMonths,
        },
        Quantity: params.item.quantity ?? 1,
        UnitPrice: params.item.unitPrice,
        Currency: currencyToSumitCode(params.item.currency),
        Duration_Months: params.item.durationMonths,
        Recurrence: params.item.recurrence ?? 0,
      },
    ],
  };
}

export function buildCreateDocumentPayload(params: BuildCreateDocumentPayloadParams): SumitCreateDocumentPayload {
  if (!params.items.length) {
    throw new Error("buildCreateDocumentPayload: items[] must not be empty");
  }

  const customer = compact({
    SearchMode: (params.customer.searchMode ?? 0) as SumitCustomerSearchMode,
    Name: params.customer.name,
    EmailAddress: params.customer.emailAddress,
    Phone: params.customer.phone,
    ExternalIdentifier: params.customer.externalIdentifier,
    ID: params.customer.id,
    CompanyNumber: params.customer.taxId,
    Address: params.customer.address,
    City: params.customer.city,
    ZipCode: params.customer.zipCode,
    NoVAT: params.customer.noVAT,
  }) as SumitCreateDocumentPayload["Details"]["Customer"];

  const sendByEmail = params.sendByEmail
    ? {
        EmailAddress: params.sendByEmail.emailAddress,
        Original: params.sendByEmail.original ?? true,
        SendAsPaymentRequest: params.sendByEmail.sendAsPaymentRequest ?? false,
      }
    : undefined;

  const details = compact({
    Type: params.documentType,
    Customer: customer,
    SendByEmail: sendByEmail,
    Language: params.language,
    Currency: params.currency ? currencyToSumitString(params.currency) : undefined,
    Description: params.description,
    ExternalReference: params.externalReference,
    Date: params.date,
    DueDate: params.dueDate,
    IsDraft: params.isDraft,
  }) as SumitCreateDocumentPayload["Details"];

  const items: SumitCreateDocumentPayload["Items"] = params.items.map((item) => {
    const quantity = item.quantity ?? 1;
    const totalPrice = item.totalPrice ?? round2(item.unitPrice * quantity);
    return {
      Quantity: quantity,
      UnitPrice: item.unitPrice,
      TotalPrice: totalPrice,
      ...(item.vat !== undefined ? { VAT: item.vat } : {}),
      Item: compact({
        Name: item.name,
        Description: item.description,
        SKU: item.sku,
        ExternalIdentifier: item.externalIdentifier,
        SearchMode: 0 as SumitCustomerSearchMode,
      }) as SumitCreateDocumentPayload["Items"][number]["Item"],
    };
  });

  return compact({
    Credentials: { CompanyID: params.companyId, APIKey: params.apiKey },
    Details: details,
    Items: items,
    Payments: [] as never[],
    VATIncluded: params.vatIncluded ?? true,
    VATPerItem: params.vatPerItem,
    VATRate: params.vatRate,
    ResponseLanguage: params.responseLanguage,
  }) as SumitCreateDocumentPayload;
}

export function normalizeCreateDocumentResponse(response: unknown): NormalizedSumitEvent {
  if (!isRecord(response)) {
    return unmappedDiagnostic(null);
  }

  const data = getRecord(response.Data) ?? response;
  const documentId =
    stringValue(response.DocumentID) ??
    stringValue(data.DocumentID) ??
    stringValue(getRecord(data.Document)?.ID);
  const documentNumber =
    stringValue(data.DocumentNumber) ??
    stringValue(response.DocumentNumber) ??
    stringValue(getRecord(data.Document)?.Number);
  const documentDownloadUrl =
    stringValue(data.DocumentDownloadURL) ??
    stringValue(response.DocumentDownloadURL) ??
    stringValue(getRecord(data.Document)?.DownloadURL);
  const customerId =
    stringValue(response.CustomerID) ??
    stringValue(data.CustomerID) ??
    stringValue(getRecord(data.Customer)?.ID);

  const status = stringValue(response.Status);
  const userErrorMessage = safeText(response.UserErrorMessage);
  const technicalErrorDetails = safeText(response.TechnicalErrorDetails);
  const failed = isFailedStatus({ status, userErrorMessage, technicalErrorDetails });
  const succeeded = !failed && Boolean(documentId) && (status === undefined || status === "Success" || status === "0" || status === "000");

  if (!documentId && !failed && !userErrorMessage && !technicalErrorDetails) {
    return unmappedDiagnostic(response);
  }

  const eventType: SumitNormalizedEventType = failed ? "document.failed" : succeeded ? "document.created" : "sumit.trigger.unmapped";

  return compact({
    ok: failed ? false : succeeded ? true : null,
    eventType,
    documentId,
    documentNumber,
    documentDownloadUrl,
    customerId,
    status,
    userErrorMessage,
    technicalErrorDetails,
    ...(eventType === "sumit.trigger.unmapped" || failed ? { diagnostic: diagnosticFor(response) } : {}),
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function baseChargeEnvelope(params: BaseChargeParams): BaseChargePayload {
  return {
    Credentials: {
      CompanyID: params.companyId,
      APIKey: params.apiKey,
    },
    Customer: {
      ExternalIdentifier: params.customer.externalIdentifier,
      SearchMode: 2,
      Name: params.customer.name,
      EmailAddress: params.customer.emailAddress,
    },
    SingleUseToken: params.singleUseToken,
    VATIncluded: params.vatIncluded ?? true,
    OnlyDocument: params.onlyDocument ?? false,
    ...(params.authoriseOnly ? { AuthoriseOnly: true as const } : {}),
  };
}

export function normalizeSumitIncomingPayload(payload: unknown): NormalizedSumitEvent {
  const objectPayload = unwrapSumitJsonEnvelope(payload instanceof URLSearchParams ? formToNestedObject(payload) : payload);
  return normalizeChargeResponse(objectPayload);
}

// Same logic for one-off and recurring responses — the response shape is
// shared, and the normalizer surfaces `recurring.charged` only when a
// `RecurringCustomerItemIDs[*]` is present.
export const normalizeRecurringChargeResponse = normalizeChargeResponse;

export function normalizeChargeResponse(response: unknown): NormalizedSumitEvent {
  if (!isRecord(response)) {
    return unmappedDiagnostic(null);
  }

  const viewTrigger = normalizeViewShapedTrigger(response);
  if (viewTrigger) return viewTrigger;

  const explicitEventType = normalizeKnownEventType(response.EventType);
  if (explicitEventType) {
    const status = stringValue(response.Status);
    const statusDescription = safeText(response.StatusDescription);
    const userErrorMessage = safeText(response.UserErrorMessage);
    const technicalErrorDetails = safeText(response.TechnicalErrorDetails);
    const failed = explicitEventType === "payment.failed" || isFailedStatus({ status, statusDescription, userErrorMessage, technicalErrorDetails });
    const eventType: SumitNormalizedEventType = failed ? "payment.failed" : explicitEventType;
    return compact({
      ok: failed ? false : explicitEventType === "recurring.cancelled" || explicitEventType === "invoice.created" ? null : true,
      eventType,
      paymentId: stringValue(response.PaymentID),
      customerId: stringValue(response.CustomerID),
      documentId: stringValue(response.DocumentID),
      recurringItemId: stringValue(response.RecurringItemID),
      amount: numberValue(response.Amount),
      currency: currencyFromSumitCode(response.Currency),
      status,
      statusDescription,
      occurredAt: stringValue(response.Timestamp),
      userErrorMessage,
      technicalErrorDetails,
    });
  }

  const payment = getRecord(response.Payment) ?? getRecord(getRecord(response.Data)?.Payment);
  const status = stringValue(payment?.Status ?? response.Status ?? getRecord(response.Data)?.Status);
  const statusDescription = stringValue(payment?.StatusDescription ?? response.StatusDescription);
  const userErrorMessage = safeText(response.UserErrorMessage);
  const technicalErrorDetails = safeText(response.TechnicalErrorDetails);
  const validPayment = booleanValue(payment?.ValidPayment ?? response.ValidPayment);
  const paymentId = stringValue(payment?.ID ?? response.PaymentID ?? response.ID);
  const customerId = stringValue(payment?.CustomerID ?? response.CustomerID ?? getRecord(response.Data)?.CustomerID);
  const documentId = stringValue(response.DocumentID ?? getRecord(response.Data)?.DocumentID);
  const recurringItemId = firstString(response.RecurringCustomerItemIDs) ?? firstString(getRecord(response.Data)?.RecurringCustomerItemIDs) ?? stringValue(response.RecurringItemID);
  const amount = numberValue(payment?.Amount ?? response.Amount);
  const currency = currencyFromSumitCode(payment?.Currency ?? response.Currency);
  const occurredAt = stringValue(payment?.Date ?? response.Timestamp ?? response.Date);

  const hasAnyMappedSignal = Boolean(
    payment || status || statusDescription || userErrorMessage || technicalErrorDetails || paymentId || customerId || documentId || recurringItemId,
  );

  if (!hasAnyMappedSignal) {
    return unmappedDiagnostic(response);
  }

  const failed = isFailedStatus({ status, statusDescription, userErrorMessage, technicalErrorDetails, validPayment });
  const successful = !failed && (validPayment === true || status === "000" || status === "0");
  const eventType: SumitNormalizedEventType = failed ? "payment.failed" : recurringItemId ? "recurring.charged" : successful ? "payment.succeeded" : "sumit.trigger.unmapped";

  return compact({
    ok: failed ? false : successful ? true : null,
    eventType,
    paymentId,
    customerId,
    documentId,
    recurringItemId,
    amount,
    currency,
    status,
    statusDescription,
    occurredAt,
    userErrorMessage,
    technicalErrorDetails,
    ...(failed ? { diagnostic: diagnosticFor(response) } : {}),
    ...(eventType === "sumit.trigger.unmapped" ? { diagnostic: diagnosticFor(response) } : {}),
  });
}

export function redactSumitPayload<T>(payload: T): T {
  return redactValue(payload) as T;
}

function redactValue(value: unknown, key = ""): unknown {
  if (value == null) return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
  }
  return value;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+/g, "[REDACTED]")
    .replace(/(כרטיס\s+אשראי|credit\s+card)\s*\(\s*\d{4}\s*\)/gi, "$1 ([REDACTED])")
    .replace(/(singleuse)?token\s*[:=]\s*[^\s;,]+/gi, "$1token=[REDACTED]")
    .replace(/api\s*key\s*[:=]\s*[^\s;,]+/gi, "api key=[REDACTED]")
    .replace(/card(number)?\s*[:=]\s*[^\s;,]+/gi, "card$1=[REDACTED]")
    .replace(/\bUpay_\w+/gi, "[REDACTED]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[REDACTED]")
    .replace(/\b\d{12,19}\b/g, "[REDACTED]")
    .replace(/((?:citizen(?:[\s_]*id)?|ת\.ז\.?|מ\.ז\.?)\W*)\d{9}\b/gi, "$1[REDACTED]");
}

function normalizeKnownEventType(value: unknown): Exclude<SumitNormalizedEventType, "sumit.trigger.unmapped"> | undefined {
  if (value === "payment.succeeded" || value === "payment.failed" || value === "recurring.charged" || value === "recurring.cancelled" || value === "invoice.created") {
    return value;
  }
  return undefined;
}

function unwrapSumitJsonEnvelope(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  const jsonValue = payload.json ?? payload.JSON;
  if (typeof jsonValue !== "string") return payload;
  try {
    return JSON.parse(jsonValue) as unknown;
  } catch {
    return payload;
  }
}

function normalizeViewShapedTrigger(response: UnknownRecord): NormalizedSumitEvent | undefined {
  if (!("Folder" in response) || !("EntityID" in response) || !("Type" in response) || !isRecord(response.Properties)) {
    return undefined;
  }

  const properties = response.Properties;
  const customer = firstRecord(properties.Property_3);
  const document = firstRecord(properties.Property_5);
  const paymentId = stringValue(response.EntityID);
  const customerId = stringValue(customer?.ID);
  const documentId = stringValue(document?.ID);
  const amount = firstNumber(properties.Billing_Amount);
  const occurredAt = firstScalarString(properties.Property_2);
  const status = stringValue(response.Type);

  return compact({
    ok: null,
    eventType: "sumit.trigger.unmapped" as const,
    paymentId,
    customerId,
    documentId,
    amount,
    status,
    occurredAt,
    diagnostic: diagnosticFor(response),
  });
}

const FORBIDDEN_FORM_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function formToNestedObject(form: URLSearchParams): UnknownRecord {
  const root: UnknownRecord = {};
  for (const [key, value] of Array.from(form.entries())) {
    const segments = key
      .split(".")
      .filter(Boolean)
      .flatMap((part) => {
        const match = part.match(/^([^\[]+)((?:\[\d+\])+)$/);
        if (!match) return [{ name: part, index: undefined as number | undefined }];
        const name = match[1];
        const indices = Array.from(match[2].matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]));
        return [{ name, index: undefined as number | undefined }, ...indices.map((index) => ({ name: "", index }))];
      });

    if (segments.some((segment) => segment.index === undefined && FORBIDDEN_FORM_KEYS.has(segment.name))) continue;

    let current: UnknownRecord | unknown[] = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const next = segments[i + 1];
      const wantArray = next.index !== undefined;
      current = descend(current, segment, wantArray);
    }
    assign(current, segments[segments.length - 1], parseScalar(value));
  }
  return root;
}

function descend(node: UnknownRecord | unknown[], segment: { name: string; index: number | undefined }, wantArray: boolean): UnknownRecord | unknown[] {
  const existing = read(node, segment);
  if (wantArray) {
    if (Array.isArray(existing)) return existing;
    const fresh: unknown[] = [];
    write(node, segment, fresh);
    return fresh;
  }
  if (isRecord(existing)) return existing;
  const fresh: UnknownRecord = {};
  write(node, segment, fresh);
  return fresh;
}

function read(node: UnknownRecord | unknown[], segment: { name: string; index: number | undefined }): unknown {
  if (segment.index !== undefined) return Array.isArray(node) ? node[segment.index] : undefined;
  return Array.isArray(node) ? undefined : node[segment.name];
}

function write(node: UnknownRecord | unknown[], segment: { name: string; index: number | undefined }, value: unknown): void {
  if (segment.index !== undefined && Array.isArray(node)) node[segment.index] = value;
  else if (!Array.isArray(node)) node[segment.name] = value;
}

function assign(node: UnknownRecord | unknown[], segment: { name: string; index: number | undefined }, value: unknown): void {
  if (segment.index !== undefined && Array.isArray(node)) {
    node[segment.index] = value;
    return;
  }
  if (Array.isArray(node)) return;
  const existing = node[segment.name];
  if (Array.isArray(existing)) existing.push(value);
  else if (existing !== undefined) node[segment.name] = [existing, value];
  else node[segment.name] = value;
}

function parseScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value) && !/^-?0\d/.test(value)) return Number(value);
  return value;
}

function isFailedStatus({
  status,
  statusDescription,
  userErrorMessage,
  technicalErrorDetails,
  validPayment,
}: {
  status?: string;
  statusDescription?: string;
  userErrorMessage?: string;
  technicalErrorDetails?: string;
  validPayment?: boolean;
}) {
  if (validPayment === false) return true;
  if (status && /^\d+$/.test(status) && status !== "0" && status !== "000") return true;
  const text = [status, statusDescription, userErrorMessage, technicalErrorDetails].filter(Boolean).join(" ").toLowerCase();
  return /fail|failed|failure|declin|error|upay_|נכשל|נכשלה|שגיאה|נמוך מדי|נדחה|סורב/.test(text);
}

function diagnosticFor(response: UnknownRecord | null): SumitDiagnostic {
  const data = response ? getRecord(response.Data) : null;
  const base = response && "Data" in response ? data : response;
  const properties = response ? getRecord(response.Properties) : undefined;
  const customerId = data?.CustomerID ?? response?.CustomerID ?? getRecord(response?.Payment)?.CustomerID ?? firstRecord(properties?.Property_3)?.ID;
  const recurringItems = [response?.RecurringCustomerItemIDs, data?.RecurringCustomerItemIDs].find(Array.isArray) as unknown[] | undefined;
  return {
    hasData: base != null,
    dataKeys: base ? Object.keys(base).sort() : [],
    hasCustomerID: customerId != null,
    recurringItemCount: recurringItems?.length ?? 0,
    ...(safeText(response?.UserErrorMessage) ? { userErrorMessage: safeText(response?.UserErrorMessage) } : {}),
    ...(safeText(response?.TechnicalErrorDetails) ? { technicalErrorDetails: safeText(response?.TechnicalErrorDetails) } : {}),
  };
}

function unmappedDiagnostic(response: UnknownRecord | null): NormalizedSumitEvent {
  return {
    ok: null,
    eventType: "sumit.trigger.unmapped",
    diagnostic: diagnosticFor(response),
  };
}

function compact<T extends UnknownRecord>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  return String(value);
}

function safeText(value: unknown): string | undefined {
  const text = stringValue(value);
  return text ? redactSensitiveText(text) : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const first = value[0];
  return first == null ? undefined : String(first);
}

function firstRecord(value: unknown): UnknownRecord | undefined {
  if (!Array.isArray(value)) return undefined;
  return getRecord(value[0]);
}

function firstNumber(value: unknown): number | undefined {
  if (!Array.isArray(value)) return numberValue(value);
  return numberValue(value[0]);
}

function firstScalarString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return stringValue(value);
  return stringValue(value[0]);
}
