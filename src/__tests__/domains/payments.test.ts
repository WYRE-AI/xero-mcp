/**
 * Tests for payments domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock functions using vi.hoisted so they're available when vi.mock is hoisted
const { mockGet, mockPost, mockClient } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockPost = vi.fn();
  const mockClient = { get: mockGet, post: mockPost };
  return { mockGet, mockPost, mockClient };
});

// Mock the client module before importing the handler
vi.mock("../../utils/client.js", () => ({
  getClient: () => mockClient,
}));

// Import handler after mocking
import { paymentTools, handlePaymentTool } from "../../domains/payments.js";

describe("Payments Domain Handler", () => {
  beforeEach(() => {
    mockGet.mockClear();
    mockPost.mockClear();

    mockGet.mockResolvedValue({
      Payments: [
        { PaymentID: "1", Amount: 100 },
        { PaymentID: "2", Amount: 200 },
      ],
    });
    mockPost.mockResolvedValue({
      Payments: [{ PaymentID: "100", Amount: 50 }],
    });
  });

  describe("paymentTools", () => {
    it("should export all payment tools", () => {
      const names = paymentTools.map((t) => t.name);
      expect(names).toEqual([
        "xero_payments_list",
        "xero_payments_get",
        "xero_payments_create",
      ]);
    });

    it("xero_payments_get should require paymentId", () => {
      const tool = paymentTools.find((t) => t.name === "xero_payments_get");
      expect(tool?.inputSchema.required).toContain("paymentId");
    });

    it("xero_payments_create should require InvoiceID, AccountID, Amount, and Date", () => {
      const tool = paymentTools.find((t) => t.name === "xero_payments_create");
      expect(tool?.inputSchema.required).toEqual([
        "InvoiceID",
        "AccountID",
        "Amount",
        "Date",
      ]);
    });
  });

  describe("handlePaymentTool", () => {
    describe("xero_payments_list", () => {
      it("should list all payments with no filters", async () => {
        const result = await handlePaymentTool("xero_payments_list", {});

        expect(mockGet).toHaveBeenCalledWith("Payments", {});
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Payments).toHaveLength(2);
      });

      it("should apply the page filter", async () => {
        await handlePaymentTool("xero_payments_list", { page: 2 });

        expect(mockGet).toHaveBeenCalledWith("Payments", { page: "2" });
      });

      it("should build a where clause from Status", async () => {
        await handlePaymentTool("xero_payments_list", { Status: "AUTHORISED" });

        expect(mockGet).toHaveBeenCalledWith("Payments", {
          where: 'Status=="AUTHORISED"',
        });
      });

      it("should combine page and Status filters", async () => {
        await handlePaymentTool("xero_payments_list", {
          page: 3,
          Status: "DELETED",
        });

        expect(mockGet).toHaveBeenCalledWith("Payments", {
          page: "3",
          where: 'Status=="DELETED"',
        });
      });
    });

    describe("xero_payments_get", () => {
      it("should fetch a single payment by ID", async () => {
        mockGet.mockResolvedValueOnce({ PaymentID: "1", Amount: 100 });

        const result = await handlePaymentTool("xero_payments_get", {
          paymentId: "1",
        });

        expect(mockGet).toHaveBeenCalledWith("Payments/1");
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Amount).toBe(100);
      });
    });

    describe("xero_payments_create", () => {
      it("should create a payment with only the required fields", async () => {
        await handlePaymentTool("xero_payments_create", {
          InvoiceID: "inv-1",
          AccountID: "acc-1",
          Amount: 100,
          Date: "2026-01-01",
        });

        expect(mockPost).toHaveBeenCalledWith("Payments", {
          Payments: [
            {
              Invoice: { InvoiceID: "inv-1" },
              Account: { AccountID: "acc-1" },
              Amount: 100,
              Date: "2026-01-01",
            },
          ],
        });
      });

      it("should include Reference when provided", async () => {
        await handlePaymentTool("xero_payments_create", {
          InvoiceID: "inv-1",
          AccountID: "acc-1",
          Amount: 100,
          Date: "2026-01-01",
          Reference: "PO-123",
        });

        expect(mockPost).toHaveBeenCalledWith("Payments", {
          Payments: [
            {
              Invoice: { InvoiceID: "inv-1" },
              Account: { AccountID: "acc-1" },
              Amount: 100,
              Date: "2026-01-01",
              Reference: "PO-123",
            },
          ],
        });
      });

      it("should omit Reference entirely when not provided, not send it as undefined", async () => {
        await handlePaymentTool("xero_payments_create", {
          InvoiceID: "inv-1",
          AccountID: "acc-1",
          Amount: 100,
          Date: "2026-01-01",
        });

        const [, body] = mockPost.mock.calls[0];
        const sentPayment = (body as { Payments: Record<string, unknown>[] })
          .Payments[0];
        expect(Object.keys(sentPayment)).toEqual([
          "Invoice",
          "Account",
          "Amount",
          "Date",
        ]);
      });

      it("should return the created payment from the API response", async () => {
        const result = await handlePaymentTool("xero_payments_create", {
          InvoiceID: "inv-1",
          AccountID: "acc-1",
          Amount: 50,
          Date: "2026-01-01",
        });

        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Payments[0].PaymentID).toBe("100");
      });
    });

    describe("unknown tool", () => {
      it("should return an error result for an unrecognized tool name", async () => {
        const result = await handlePaymentTool("xero_payments_bogus", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown payment tool");
      });

      it("should not touch the API client for an unrecognized tool", async () => {
        await handlePaymentTool("xero_payments_bogus", {});
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
      });
    });
  });
});
