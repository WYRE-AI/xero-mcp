/**
 * Tests for contacts domain handler
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

// Mock elicitation so xero_contacts_list's "no filters" branch doesn't hang
// waiting on a real MCP client prompt.
const { mockElicitText } = vi.hoisted(() => ({ mockElicitText: vi.fn() }));
vi.mock("../../utils/elicitation.js", () => ({
  elicitText: mockElicitText,
}));

// Import handler after mocking
import { contactTools, handleContactTool } from "../../domains/contacts.js";

describe("Contacts Domain Handler", () => {
  beforeEach(() => {
    mockGet.mockClear();
    mockPost.mockClear();
    mockElicitText.mockClear();

    mockGet.mockResolvedValue({
      Contacts: [
        { ContactID: "1", Name: "Acme Co" },
        { ContactID: "2", Name: "Beta Inc" },
      ],
    });
    mockPost.mockResolvedValue({
      Contacts: [{ ContactID: "100", Name: "New Contact" }],
    });
    // Default: user declines the elicitation prompt (blank search).
    mockElicitText.mockResolvedValue(null);
  });

  describe("contactTools", () => {
    it("should export all contact tools", () => {
      const names = contactTools.map((t) => t.name);
      expect(names).toEqual([
        "xero_contacts_list",
        "xero_contacts_get",
        "xero_contacts_create",
        "xero_contacts_search",
      ]);
    });

    it("xero_contacts_get should require contactId", () => {
      const tool = contactTools.find((t) => t.name === "xero_contacts_get");
      expect(tool?.inputSchema.required).toContain("contactId");
    });

    it("xero_contacts_create should require Name", () => {
      const tool = contactTools.find((t) => t.name === "xero_contacts_create");
      expect(tool?.inputSchema.required).toContain("Name");
    });

    it("xero_contacts_search should require term", () => {
      const tool = contactTools.find((t) => t.name === "xero_contacts_search");
      expect(tool?.inputSchema.required).toContain("term");
    });
  });

  describe("handleContactTool", () => {
    describe("xero_contacts_list", () => {
      it("should elicit a search term when called with no filters, then apply it", async () => {
        mockElicitText.mockResolvedValueOnce("Acme");

        const result = await handleContactTool("xero_contacts_list", {});

        expect(mockElicitText).toHaveBeenCalledTimes(1);
        expect(mockGet).toHaveBeenCalledWith("Contacts", {
          where: 'Name.Contains("Acme")',
        });
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Contacts).toHaveLength(2);
      });

      it("should skip elicitation and list all when the user declines", async () => {
        const result = await handleContactTool("xero_contacts_list", {});

        expect(mockElicitText).toHaveBeenCalledTimes(1);
        expect(mockGet).toHaveBeenCalledWith("Contacts", {});
        expect(result.isError).toBeUndefined();
      });

      it("should skip elicitation entirely when page or where is explicitly provided", async () => {
        await handleContactTool("xero_contacts_list", { page: 2 });

        expect(mockElicitText).not.toHaveBeenCalled();
        expect(mockGet).toHaveBeenCalledWith("Contacts", { page: "2" });
      });

      it("should pass an explicit where clause through untouched", async () => {
        await handleContactTool("xero_contacts_list", {
          where: 'ContactStatus=="ACTIVE"',
        });

        expect(mockElicitText).not.toHaveBeenCalled();
        expect(mockGet).toHaveBeenCalledWith("Contacts", {
          where: 'ContactStatus=="ACTIVE"',
        });
      });
    });

    describe("xero_contacts_get", () => {
      it("should fetch a single contact by ID", async () => {
        mockGet.mockResolvedValueOnce({ ContactID: "1", Name: "Acme Co" });

        const result = await handleContactTool("xero_contacts_get", {
          contactId: "1",
        });

        expect(mockGet).toHaveBeenCalledWith("Contacts/1");
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Name).toBe("Acme Co");
      });
    });

    describe("xero_contacts_create", () => {
      it("should create a contact with only the required field", async () => {
        await handleContactTool("xero_contacts_create", { Name: "New Contact" });

        expect(mockPost).toHaveBeenCalledWith("Contacts", {
          Contacts: [{ Name: "New Contact" }],
        });
      });

      it("should map Phone into the Phones array shape Xero expects", async () => {
        await handleContactTool("xero_contacts_create", {
          Name: "New Contact",
          Phone: "555-1234",
        });

        expect(mockPost).toHaveBeenCalledWith("Contacts", {
          Contacts: [
            {
              Name: "New Contact",
              Phones: [{ PhoneType: "DEFAULT", PhoneNumber: "555-1234" }],
            },
          ],
        });
      });

      it("should include all optional fields when provided", async () => {
        await handleContactTool("xero_contacts_create", {
          Name: "New Contact",
          EmailAddress: "new@contact.com",
          FirstName: "New",
          LastName: "Contact",
          AccountNumber: "ACC-1",
          TaxNumber: "TAX-1",
          IsCustomer: true,
          IsSupplier: false,
        });

        expect(mockPost).toHaveBeenCalledWith("Contacts", {
          Contacts: [
            {
              Name: "New Contact",
              EmailAddress: "new@contact.com",
              FirstName: "New",
              LastName: "Contact",
              AccountNumber: "ACC-1",
              TaxNumber: "TAX-1",
              IsCustomer: true,
              IsSupplier: false,
            },
          ],
        });
      });

      it("should omit optional fields entirely when not provided, not send them as undefined", async () => {
        await handleContactTool("xero_contacts_create", { Name: "New Contact" });

        const [, body] = mockPost.mock.calls[0];
        const sentContact = (body as { Contacts: Record<string, unknown>[] })
          .Contacts[0];
        expect(Object.keys(sentContact)).toEqual(["Name"]);
      });

      it("should return the created contact from the API response", async () => {
        const result = await handleContactTool("xero_contacts_create", {
          Name: "New Contact",
        });

        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Contacts[0].ContactID).toBe("100");
      });
    });

    describe("xero_contacts_search", () => {
      it("should search by name via a where clause", async () => {
        await handleContactTool("xero_contacts_search", { term: "Acme" });

        expect(mockGet).toHaveBeenCalledWith("Contacts", {
          where: 'Name.Contains("Acme")',
        });
      });

      it("should not elicit when a search term is already provided", async () => {
        await handleContactTool("xero_contacts_search", { term: "Acme" });
        expect(mockElicitText).not.toHaveBeenCalled();
      });
    });

    describe("unknown tool", () => {
      it("should return an error result for an unrecognized tool name", async () => {
        const result = await handleContactTool("xero_contacts_bogus", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown contact tool");
      });

      it("should not touch the API client for an unrecognized tool", async () => {
        await handleContactTool("xero_contacts_bogus", {});
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
      });
    });
  });
});
