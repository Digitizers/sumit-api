import { describe, expect, it } from "vitest";
import {
  buildRecurringChargePayload,
  normalizeRecurringChargeResponse,
  normalizeSumitIncomingPayload,
  redactSumitPayload,
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

  it("redacts DirectDebit_* bank fields", () => {
    const redacted = redactSumitPayload({
      PaymentMethod: {
        DirectDebit_Bank: 12,
        DirectDebit_Branch: 567,
        DirectDebit_Account: 123456,
      },
    }) as { PaymentMethod: Record<string, string> };

    expect(redacted.PaymentMethod.DirectDebit_Bank).toBe("[REDACTED]");
    expect(redacted.PaymentMethod.DirectDebit_Branch).toBe("[REDACTED]");
    expect(redacted.PaymentMethod.DirectDebit_Account).toBe("[REDACTED]");
  });

  it("redacts CardOwnerSocialId, 9-digit national IDs, and Upay_* error codes", () => {
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
      EmailAddress: "billing@example.invalid",
    });

    expect(JSON.stringify(redacted)).not.toContain("secret-token");
    expect(JSON.stringify(redacted)).not.toContain("secret-api-key");
    expect(JSON.stringify(redacted)).not.toContain("card-token");
    expect(JSON.stringify(redacted)).not.toContain("billing@example.invalid");
    expect(redacted).toMatchObject({
      SingleUseToken: "[REDACTED]",
      Credentials: { APIKey: "[REDACTED]", CompanyID: 123 },
      Payment: {
        CreditCard_Token: "[REDACTED]",
        CreditCard_LastDigits: "[REDACTED]",
        Status: "000",
      },
      EmailAddress: "[REDACTED]",
    });
  });
});
