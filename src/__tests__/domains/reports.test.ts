/**
 * Tests for reports domain handler
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
import { reportTools, handleReportTool } from "../../domains/reports.js";

describe("Reports Domain Handler", () => {
  beforeEach(() => {
    mockGet.mockClear();
    mockPost.mockClear();

    mockGet.mockResolvedValue({
      Reports: [{ ReportID: "ProfitAndLoss", ReportName: "Profit and Loss" }],
    });
  });

  describe("reportTools", () => {
    it("should export all report tools", () => {
      const names = reportTools.map((t) => t.name);
      expect(names).toEqual([
        "xero_reports_profit_and_loss",
        "xero_reports_balance_sheet",
        "xero_reports_aged_receivables",
        "xero_reports_aged_payables",
      ]);
    });

    it("xero_reports_profit_and_loss should require fromDate and toDate", () => {
      const tool = reportTools.find(
        (t) => t.name === "xero_reports_profit_and_loss"
      );
      expect(tool?.inputSchema.required).toEqual(["fromDate", "toDate"]);
    });

    it("xero_reports_balance_sheet should require date", () => {
      const tool = reportTools.find(
        (t) => t.name === "xero_reports_balance_sheet"
      );
      expect(tool?.inputSchema.required).toEqual(["date"]);
    });

    it("xero_reports_aged_receivables should require date", () => {
      const tool = reportTools.find(
        (t) => t.name === "xero_reports_aged_receivables"
      );
      expect(tool?.inputSchema.required).toEqual(["date"]);
    });

    it("xero_reports_aged_payables should require date", () => {
      const tool = reportTools.find(
        (t) => t.name === "xero_reports_aged_payables"
      );
      expect(tool?.inputSchema.required).toEqual(["date"]);
    });
  });

  describe("handleReportTool", () => {
    describe("xero_reports_profit_and_loss", () => {
      it("should request the ProfitAndLoss report with fromDate and toDate", async () => {
        const result = await handleReportTool("xero_reports_profit_and_loss", {
          fromDate: "2026-01-01",
          toDate: "2026-01-31",
        });

        expect(mockGet).toHaveBeenCalledWith("Reports/ProfitAndLoss", {
          fromDate: "2026-01-01",
          toDate: "2026-01-31",
        });
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Reports[0].ReportID).toBe("ProfitAndLoss");
      });
    });

    describe("xero_reports_balance_sheet", () => {
      it("should request the BalanceSheet report with date", async () => {
        await handleReportTool("xero_reports_balance_sheet", {
          date: "2026-01-31",
        });

        expect(mockGet).toHaveBeenCalledWith("Reports/BalanceSheet", {
          date: "2026-01-31",
        });
      });
    });

    describe("xero_reports_aged_receivables", () => {
      it("should request the AgedReceivablesByContact report with date", async () => {
        await handleReportTool("xero_reports_aged_receivables", {
          date: "2026-01-31",
        });

        expect(mockGet).toHaveBeenCalledWith(
          "Reports/AgedReceivablesByContact",
          { date: "2026-01-31" }
        );
      });
    });

    describe("xero_reports_aged_payables", () => {
      it("should request the AgedPayablesByContact report with date", async () => {
        await handleReportTool("xero_reports_aged_payables", {
          date: "2026-01-31",
        });

        expect(mockGet).toHaveBeenCalledWith(
          "Reports/AgedPayablesByContact",
          { date: "2026-01-31" }
        );
      });
    });

    describe("unknown tool", () => {
      it("should return an error result for an unrecognized tool name", async () => {
        const result = await handleReportTool("xero_reports_bogus", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown report tool");
      });

      it("should not touch the API client for an unrecognized tool", async () => {
        await handleReportTool("xero_reports_bogus", {});
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
      });
    });
  });
});
