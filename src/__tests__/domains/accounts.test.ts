/**
 * Tests for accounts domain handler
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
import { accountTools, handleAccountTool } from "../../domains/accounts.js";

describe("Accounts Domain Handler", () => {
  beforeEach(() => {
    mockGet.mockClear();
    mockPost.mockClear();

    mockGet.mockResolvedValue({
      Accounts: [
        { AccountID: "1", Code: "200", Name: "Sales" },
        { AccountID: "2", Code: "400", Name: "Bank Fees" },
      ],
    });
  });

  describe("accountTools", () => {
    it("should export all account tools", () => {
      const names = accountTools.map((t) => t.name);
      expect(names).toEqual(["xero_accounts_list", "xero_accounts_get"]);
    });

    it("xero_accounts_get should require accountId", () => {
      const tool = accountTools.find((t) => t.name === "xero_accounts_get");
      expect(tool?.inputSchema.required).toContain("accountId");
    });
  });

  describe("handleAccountTool", () => {
    describe("xero_accounts_list", () => {
      it("should list all accounts with no filters", async () => {
        const result = await handleAccountTool("xero_accounts_list", {});

        expect(mockGet).toHaveBeenCalledWith("Accounts", {});
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Accounts).toHaveLength(2);
      });

      it("should build a where clause from Type alone", async () => {
        await handleAccountTool("xero_accounts_list", { Type: "BANK" });

        expect(mockGet).toHaveBeenCalledWith("Accounts", {
          where: 'Type=="BANK"',
        });
      });

      it("should build a where clause from Class alone", async () => {
        await handleAccountTool("xero_accounts_list", { Class: "REVENUE" });

        expect(mockGet).toHaveBeenCalledWith("Accounts", {
          where: 'Class=="REVENUE"',
        });
      });

      it("should combine Type and Class filters with AND, in that order", async () => {
        await handleAccountTool("xero_accounts_list", {
          Type: "BANK",
          Class: "ASSET",
        });

        expect(mockGet).toHaveBeenCalledWith("Accounts", {
          where: 'Type=="BANK" AND Class=="ASSET"',
        });
      });
    });

    describe("xero_accounts_get", () => {
      it("should fetch a single account by ID", async () => {
        mockGet.mockResolvedValueOnce({
          AccountID: "1",
          Code: "200",
          Name: "Sales",
        });

        const result = await handleAccountTool("xero_accounts_get", {
          accountId: "1",
        });

        expect(mockGet).toHaveBeenCalledWith("Accounts/1");
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Name).toBe("Sales");
      });
    });

    describe("unknown tool", () => {
      it("should return an error result for an unrecognized tool name", async () => {
        const result = await handleAccountTool("xero_accounts_bogus", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown account tool");
      });

      it("should not touch the API client for an unrecognized tool", async () => {
        await handleAccountTool("xero_accounts_bogus", {});
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
      });
    });
  });
});
