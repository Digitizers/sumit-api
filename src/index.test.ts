import { describe, expect, it } from "vitest";
import {
  buildCreateDocumentPayload,
  buildOneOffChargePayload,
  buildRecurringChargePayload,
  currencyToSumitString,
  normalizeChargeResponse,
  normalizeCreateDocumentResponse,
  normalizeRecurringChargeResponse,
  normalizeSumitIncomingPayload,
  redactSumitPayload,
  SUMIT_DOCUMENT_TYPE,
} from "./index";

describe("@deepclaw/sumit", () => {
  it("builds the SUMIT recurring charge payload shape used by direct checkout", () => {
    const payload = buildRecurringChargePayload({
      companyId: 123,
      apiKey: "api-key",
      customer: {
        externalIdentifier: "org-1",
        name: "Acme",
        emailAddress: "billing@example.invalid",
      },
      singleUseToken: "single-use-token",
      item: {
        name: "DeepClaw Pro Plan",
        description: "Pro subscription - monthly",
        quantity: 1,
        unitPrice: 19,
        currency: "USD",
        durationMonths: 1,
      },
    });

    expect(payload).toEqual({
      Credentials: { CompanyID: 123, APIKey: "api-key" },
      Customer: {
        ExternalIdentifier: "org-1",
        SearchMode: 2,
        Name: "Acme",
        EmailAddress: "billing@example.invalid",
      },
      SingleUseToken: "single-use-token",
      Items: [
        {
          Item: {
            Name: "DeepClaw Pro Plan",
            Description: "Pro subscription - monthly",
            Duration_Months: 1,
          },
          Quantity: 1,
          UnitPrice: 19,
          Currency: 1,
          Duration_Months: 1,
          Recurrence: 0,
        },
      ],
      VATIncluded: true,
      OnlyDocument: false,
    });
  });

  it("builds the SUMIT one-off charge payload without Duration_Months/Recurrence", () => {
    const payload = buildOneOffChargePayload({
      companyId: 123,
      apiKey: "api-key",
      customer: {
        externalIdentifier: "org-1",
        name: "Acme",
        emailAddress: "billing@example.invalid",
      },
      singleUseToken: "single-use-token",
      item: {
        name: "Pro Plan (one-off)",
        description: "One-time charge",
        quantity: 2,
        unitPrice: 19,
        currency: "ILS",
      },
      vatIncluded: false,
    });

    expect(payload).toEqual({
      Credentials: { CompanyID: 123, APIKey: "api-key" },
      Customer: {
        ExternalIdentifier: "org-1",
        SearchMode: 2,
        Name: "Acme",
        EmailAddress: "billing@example.invalid",
      },
      SingleUseToken: "single-use-token",
      Items: [
        {
          Item: { Name: "Pro Plan (one-off)", Description: "One-time charge" },
          Quantity: 2,
          UnitPrice: 19,
          Currency: 0,
        },
      ],
      VATIncluded: false,
      OnlyDocument: false,
    });
  });

  it("exposes normalizeChargeResponse as the canonical normalizer (alias for normalizeRecurringChargeResponse)", () => {
    expect(normalizeChargeResponse).toBe(normalizeRecurringChargeResponse);
  });

  it("normalizes a one-off success response (no RecurringCustomerItemIDs) as payment.succeeded", () => {
    const result = normalizeChargeResponse({
      Payment: { ID: 111, CustomerID: 222, ValidPayment: true, Status: "000", Amount: 19, Currency: 0 },
      DocumentID: 333,
    });

    expect(result.ok).toBe(true);
    expect(result.eventType).toBe("payment.succeeded");
    expect(result.recurringItemId).toBeUndefined();
    expect(result.paymentId).toBe("111");
    expect(result.documentId).toBe("333");
  });

  it("normalizes the successful SUMIT recurring charge response observed in production smoke", () => {
    const result = normalizeRecurringChargeResponse({
      Payment: {
        ID: 111,
        CustomerID: 222,
        Date: "2026-04-29T17:46:17+03:00",
        ValidPayment: true,
        Status: "000",
        StatusDescription: "מאושר (קוד 000)",
        Amount: 1,
        Currency: 1,
      },
      DocumentID: 333,
      CustomerID: 222,
      RecurringCustomerItemIDs: [444],
    });

    expect(result).toEqual({
      ok: true,
      eventType: "recurring.charged",
      paymentId: "111",
      customerId: "222",
      documentId: "333",
      recurringItemId: "444",
      amount: 1,
      currency: "USD",
      status: "000",
      statusDescription: "מאושר (קוד 000)",
      occurredAt: "2026-04-29T17:46:17+03:00",
    });
  });

  it("normalizes failed SUMIT responses without recurring identifiers into safe diagnostics", () => {
    const result = normalizeRecurringChargeResponse({
      Status: "Failed",
      UserErrorMessage: "Payment failed",
      TechnicalErrorDetails: "הסכום נמוך מדי יש להקליד סכום גבוה יותר. (קוד Upay_30001419)",
      Data: null,
    });

    expect(result).toEqual({
      ok: false,
      eventType: "payment.failed",
      status: "Failed",
      userErrorMessage: "Payment failed",
      technicalErrorDetails: "הסכום נמוך מדי יש להקליד סכום גבוה יותר. (קוד [REDACTED])",
      diagnostic: {
        hasData: false,
        dataKeys: [],
        hasCustomerID: false,
        recurringItemCount: 0,
        userErrorMessage: "Payment failed",
        technicalErrorDetails: "הסכום נמוך מדי יש להקליד סכום גבוה יותר. (קוד [REDACTED])",
      },
    });
  });

  it("normalizes JSON trigger payloads without EventType instead of rejecting them", () => {
    const result = normalizeSumitIncomingPayload({
      Payment: {
        ID: 111,
        CustomerID: 222,
        ValidPayment: true,
        Status: "000",
        Amount: 1,
        Currency: 1,
      },
      DocumentID: 333,
      RecurringCustomerItemIDs: [444],
    });

    expect(result.eventType).toBe("recurring.charged");
    expect(result.paymentId).toBe("111");
  });

  it("normalizes form trigger payloads and keeps unmapped payloads observable", () => {
    const form = new URLSearchParams({ "Payment.Status": "000", "Payment.ValidPayment": "true", "Payment.ID": "111" });

    expect(normalizeSumitIncomingPayload(form).eventType).toBe("payment.succeeded");
    expect(normalizeSumitIncomingPayload({ Some: "view-shaped-card" })).toEqual({
      ok: null,
      eventType: "sumit.trigger.unmapped",
      diagnostic: {
        hasData: true,
        dataKeys: ["Some"],
        hasCustomerID: false,
        recurringItemCount: 0,
      },
    });
  });

  it("preserves leading-zero status codes from urlencoded triggers", () => {
    const form = new URLSearchParams({ "Payment.Status": "000", "Payment.ValidPayment": "true" });
    expect(normalizeSumitIncomingPayload(form).status).toBe("000");
  });

  it("parses urlencoded array indices into RecurringCustomerItemIDs", () => {
    const form = new URLSearchParams();
    form.append("Payment.ValidPayment", "true");
    form.append("Payment.Status", "000");
    form.append("Payment.ID", "111");
    form.append("RecurringCustomerItemIDs[0]", "444");
    form.append("RecurringCustomerItemIDs[1]", "555");

    const result = normalizeSumitIncomingPayload(form);
    expect(result.eventType).toBe("recurring.charged");
    expect(result.recurringItemId).toBe("444");
  });

  it("extracts reconciliation fields from real SUMIT view-shaped trigger payloads", () => {
    const triggerPayload = {
      Folder: 10,
      EntityID: 20,
      Type: "Create",
      Properties: {
        Property_2: ["2026-04-30T03:01:25+03:00"],
        Billing_Amount: [1.18],
        Property_3: [{ ID: 30, Name: "DeepClaw", Version: 3, Status: 0, SchemaID: 300 }],
        Property_4: [{ ID: 40, Name: "DeepClaw Webhook Smoke", Version: 0, Status: 0, SchemaID: 400 }],
        Billing_PaymentMethod: [{ ID: 50, Name: "כרטיס אשראי (9999)", Version: 0, Status: 0, SchemaID: 500 }],
        Property_5: [{ ID: 60, Name: "חשבונית מס/קבלה / 10001", Version: 1, Status: 0, SchemaID: 600 }],
        Property_6: ["customer@example.invalid"],
      },
    };
    const result = normalizeSumitIncomingPayload(triggerPayload);

    expect(result).toMatchObject({
      ok: null,
      eventType: "sumit.trigger.unmapped",
      paymentId: "20",
      customerId: "30",
      documentId: "60",
      amount: 1.18,
      status: "Create",
      occurredAt: "2026-04-30T03:01:25+03:00",
    });
    expect(result.diagnostic).toMatchObject({
      hasData: true,
      dataKeys: ["EntityID", "Folder", "Properties", "Type"],
      hasCustomerID: true,
      recurringItemCount: 0,
    });

    const formResult = normalizeSumitIncomingPayload(new URLSearchParams({ json: JSON.stringify(triggerPayload) }));
    expect(formResult).toMatchObject({
      eventType: "sumit.trigger.unmapped",
      paymentId: "20",
      documentId: "60",
      amount: 1.18,
    });
  });

  it("redacts DirectDebit_* bank fields", () => {
    const redacted = redactSumitPayload({
      PaymentMethod: {
        DirectDebit_Bank: 12,
        DirectDebit_Branch: 567,
        DirectDebit_Account: 123456,
      },
    }) as unknown as { PaymentMethod: Record<string, string> };

    expect(redacted.PaymentMethod.DirectDebit_Bank).toBe("[REDACTED]");
    expect(redacted.PaymentMethod.DirectDebit_Branch).toBe("[REDACTED]");
    expect(redacted.PaymentMethod.DirectDebit_Account).toBe("[REDACTED]");
  });

  it("redacts CardOwnerSocialId, CardOwnerName, 9-digit national IDs, and Upay_* error codes", () => {
    const redacted = redactSumitPayload({
      Payment: {
        CreditCard_CardOwnerName: "Jane Doe",
        CreditCard_CardOwnerSocialId: "123456789",
      },
      TechnicalErrorDetails: "rejected (Upay_30001419) for citizen 987654321",
    }) as { Payment: { CreditCard_CardOwnerName: string; CreditCard_CardOwnerSocialId: string }; TechnicalErrorDetails: string };

    expect(redacted.Payment.CreditCard_CardOwnerName).toBe("[REDACTED]");
    expect(redacted.Payment.CreditCard_CardOwnerSocialId).toBe("[REDACTED]");
    expect(redacted.TechnicalErrorDetails).not.toContain("Upay_30001419");
    expect(redacted.TechnicalErrorDetails).not.toContain("987654321");
  });

  it("redacts sensitive provider/payment data recursively", () => {
    const redacted = redactSumitPayload({
      SingleUseToken: "secret-token",
      Credentials: { APIKey: "secret-api-key", CompanyID: 123 },
      Payment: {
        CreditCard_Token: "card-token",
        CreditCard_LastDigits: "1234",
        Status: "000",
      },
      PaymentMethod: { Name: "כרטיס אשראי (9999)" },
      EmailAddress: "billing@example.invalid",
    });

    expect(JSON.stringify(redacted)).not.toContain("secret-token");
    expect(JSON.stringify(redacted)).not.toContain("secret-api-key");
    expect(JSON.stringify(redacted)).not.toContain("card-token");
    expect(JSON.stringify(redacted)).not.toContain("billing@example.invalid");
    expect(JSON.stringify(redacted)).not.toContain("9999");
    expect(redacted).toMatchObject({
      SingleUseToken: "[REDACTED]",
      Credentials: { APIKey: "[REDACTED]", CompanyID: 123 },
      Payment: {
        CreditCard_Token: "[REDACTED]",
        CreditCard_LastDigits: "[REDACTED]",
        Status: "000",
      },
      PaymentMethod: { Name: "כרטיס אשראי ([REDACTED])" },
      EmailAddress: "[REDACTED]",
    });
  });

  it("does not allow form-encoded prototype pollution via __proto__ keys", () => {
    const form = new URLSearchParams();
    form.append("__proto__.polluted", "yes");
    form.append("constructor.prototype.alsoPolluted", "yes");
    form.append("Payment.Status", "000");

    const event = normalizeSumitIncomingPayload(form);

    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).alsoPolluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(event.eventType).toBeDefined();
  });

  it("builds a SUMIT /accounting/documents/create/ payload for a חשבון עסקה", () => {
    const payload = buildCreateDocumentPayload({
      companyId: 123,
      apiKey: "api-key",
      documentType: SUMIT_DOCUMENT_TYPE.ProformaInvoice,
      customer: {
        externalIdentifier: "client-1",
        name: "אקמה בע״מ",
        emailAddress: "billing@example.invalid",
        taxId: "514999000",
      },
      items: [
        {
          name: "עיצוב לוגו",
          description: "כולל 3 סבבי תיקונים",
          unitPrice: 1500,
          quantity: 1,
        },
        {
          name: "שעות פיתוח",
          unitPrice: 300,
          quantity: 8,
        },
      ],
      currency: "ILS",
      vatIncluded: false,
      language: "he",
    });

    expect(payload).toEqual({
      Credentials: { CompanyID: 123, APIKey: "api-key" },
      Details: {
        Type: 3,
        Customer: {
          SearchMode: 2, // derived from externalIdentifier
          Name: "אקמה בע״מ",
          EmailAddress: "billing@example.invalid",
          ExternalIdentifier: "client-1",
          CompanyNumber: "514999000",
        },
        Language: 0, // Hebrew
        Currency: "ILS",
      },
      Items: [
        {
          Quantity: 1,
          UnitPrice: 1500,
          TotalPrice: 1500,
          Item: { Name: "עיצוב לוגו", Description: "כולל 3 סבבי תיקונים", SearchMode: 0 },
        },
        {
          Quantity: 8,
          UnitPrice: 300,
          TotalPrice: 2400,
          Item: { Name: "שעות פיתוח", SearchMode: 0 },
        },
      ],
      VATIncluded: false,
    });
  });

  it("omits Payments key entirely (SUMIT rejects empty Payments arrays on document creation)", () => {
    const payload = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "k",
      documentType: 3,
      customer: { name: "C" },
      items: [{ name: "Item", unitPrice: 10 }],
    });
    expect("Payments" in payload).toBe(false);
  });

  it("derives Customer.SearchMode: 0 default, 2 with externalIdentifier, 1 with id", () => {
    const a = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "k",
      documentType: 3,
      customer: { name: "A" },
      items: [{ name: "Item", unitPrice: 1 }],
    });
    expect(a.Details.Customer.SearchMode).toBe(0);

    const b = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "k",
      documentType: 3,
      customer: { name: "B", externalIdentifier: "ext-1" },
      items: [{ name: "Item", unitPrice: 1 }],
    });
    expect(b.Details.Customer.SearchMode).toBe(2);

    const c = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "k",
      documentType: 3,
      customer: { name: "C", id: "sumit-cust-1" },
      items: [{ name: "Item", unitPrice: 1 }],
    });
    expect(c.Details.Customer.SearchMode).toBe(1);

    const d = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "k",
      documentType: 3,
      customer: { name: "D", externalIdentifier: "ext-1", searchMode: 0 },
      items: [{ name: "Item", unitPrice: 1 }],
    });
    expect(d.Details.Customer.SearchMode).toBe(0); // explicit caller value wins
  });

  it("converts language strings to SUMIT numeric enum and drops unknown values", () => {
    const he = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "k",
      documentType: 3,
      customer: { name: "C" },
      items: [{ name: "I", unitPrice: 1 }],
      language: "he",
    });
    expect(he.Details.Language).toBe(0);

    const en = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "k",
      documentType: 3,
      customer: { name: "C" },
      items: [{ name: "I", unitPrice: 1 }],
      language: "English",
    });
    expect(en.Details.Language).toBe(1);

    const numeric = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "k",
      documentType: 3,
      customer: { name: "C" },
      items: [{ name: "I", unitPrice: 1 }],
      language: 2,
    });
    expect(numeric.Details.Language).toBe(2);

    const unknown = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "k",
      documentType: 3,
      customer: { name: "C" },
      items: [{ name: "I", unitPrice: 1 }],
      language: "klingon",
    });
    expect(unknown.Details.Language).toBeUndefined();
  });

  it("trims whitespace and drops empty strings from customer/item optional fields", () => {
    const payload = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "k",
      documentType: 3,
      customer: {
        name: "C",
        emailAddress: "  ",
        phone: "",
        taxId: "  514999000  ",
      },
      items: [{ name: "I", description: "", unitPrice: 10 }],
    });
    expect(payload.Details.Customer.EmailAddress).toBeUndefined();
    expect(payload.Details.Customer.Phone).toBeUndefined();
    expect(payload.Details.Customer.CompanyNumber).toBe("514999000");
    expect(payload.Items[0].Item.Description).toBeUndefined();
  });

  it("includes SendByEmail when requested and maps currency strings", () => {
    const payload = buildCreateDocumentPayload({
      companyId: 7,
      apiKey: "k",
      documentType: 3,
      customer: { name: "C" },
      items: [{ name: "Item", unitPrice: 10 }],
      currency: "USD",
      sendByEmail: { emailAddress: "c@example.invalid", sendAsPaymentRequest: true },
    });

    expect(payload.Details.Currency).toBe("USD");
    expect(payload.Details.SendByEmail).toEqual({
      EmailAddress: "c@example.invalid",
      Original: true,
      SendAsPaymentRequest: true,
    });
  });

  it("rejects an empty items[] array", () => {
    expect(() =>
      buildCreateDocumentPayload({
        companyId: 1,
        apiKey: "k",
        documentType: 1,
        customer: { name: "C" },
        items: [],
      }),
    ).toThrow(/items\[\] must not be empty/);
  });

  it("normalizes a successful /accounting/documents/create/ response", () => {
    const event = normalizeCreateDocumentResponse({
      Status: "Success",
      Data: {
        DocumentID: "doc-42",
        DocumentNumber: "2026001",
        DocumentDownloadURL: "https://app.sumit.co.il/accounting/documents/2026001",
        CustomerID: "cust-7",
      },
    });

    expect(event.ok).toBe(true);
    expect(event.eventType).toBe("document.created");
    expect(event.documentId).toBe("doc-42");
    expect(event.documentNumber).toBe("2026001");
    expect(event.documentDownloadUrl).toBe("https://app.sumit.co.il/accounting/documents/2026001");
    expect(event.customerId).toBe("cust-7");
  });

  it("normalizes a failed create-document response and redacts sensitive text", () => {
    const event = normalizeCreateDocumentResponse({
      Status: "Error",
      UserErrorMessage: "השגיאה נכשלה",
      TechnicalErrorDetails: "Upay_30001419 invalid token=abc",
    });

    expect(event.ok).toBe(false);
    expect(event.eventType).toBe("document.failed");
    expect(event.technicalErrorDetails).not.toContain("Upay_30001419");
    expect(event.technicalErrorDetails).not.toContain("abc");
    expect(event.diagnostic).toBeDefined();
  });

  it("redacts API key and customer email when logging a built document payload", () => {
    const payload = buildCreateDocumentPayload({
      companyId: 1,
      apiKey: "super-secret",
      documentType: 3,
      customer: { name: "C", emailAddress: "c@example.invalid" },
      items: [{ name: "Item", unitPrice: 10 }],
    });
    const redacted = redactSumitPayload(payload) as { Credentials: { APIKey: string }; Details: { Customer: { EmailAddress?: string } } };
    expect(redacted.Credentials.APIKey).toBe("[REDACTED]");
    expect(redacted.Details.Customer.EmailAddress).toBe("[REDACTED]");
  });

  it("currencyToSumitString maps codes and labels", () => {
    expect(currencyToSumitString("ILS")).toBe("ILS");
    expect(currencyToSumitString(1)).toBe("USD");
    expect(currencyToSumitString("EUR")).toBe("EUR");
  });

  it("preserves non-citizen 9-digit numbers in diagnostic text and redacts citizen IDs in context", () => {
    const passthrough = redactSumitPayload({
      TechnicalErrorDetails: "Document 123456789 was not found",
    }) as { TechnicalErrorDetails: string };
    expect(passthrough.TechnicalErrorDetails).toBe("Document 123456789 was not found");

    const redacted = redactSumitPayload({
      TechnicalErrorDetails: "rejected for citizen 987654321 (ת.ז 123456789)",
    }) as { TechnicalErrorDetails: string };
    expect(redacted.TechnicalErrorDetails).not.toContain("987654321");
    expect(redacted.TechnicalErrorDetails).not.toContain("123456789");
  });
});
