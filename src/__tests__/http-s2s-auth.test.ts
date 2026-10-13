/**
 * HTTP transport fail-closed auth.
 *
 * Startup requires a real CONDUIT_S2S_SECRET unless MCP_ALLOW_INSECURE_DEV=1.
 * Known placeholders are refused even when that flag is set. The flag binds
 * 127.0.0.1 only. /mcp rejects a missing or invalid X-Gateway-S2S header.
 * AUTH_MODE=gateway rejects requests that omit vendor credential headers
 * and must not fall back to XERO_* in process.env.
 */

import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialStore } from "../utils/client.js";
import { startHttpTransport } from "../index.js";

const S2S_SECRET = "s2s-do-not-log-7f3a";
const ENV_ACCESS_TOKEN = "env-token-must-not-be-used";
const ENV_TENANT_ID = "env-tenant-must-not-be-used";
const HEADER_ACCESS_TOKEN = "header-access-token";
const HEADER_TENANT_ID = "header-tenant-id";

const ENV_KEYS = [
  "CONDUIT_S2S_SECRET",
  "MCP_ALLOW_INSECURE_DEV",
  "MCP_HTTP_PORT",
  "MCP_HTTP_HOST",
  "AUTH_MODE",
  "XERO_ACCESS_TOKEN",
  "XERO_TENANT_ID",
  "MCP_TRANSPORT",
] as const;

const savedEnv = new Map<string, string | undefined>();

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac("sha256", secret).update(message).digest("hex");
  return `${message},v1=${hex}`;
}

function captureStderr(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  });
  return {
    text: () => lines.join("\n"),
    restore: () => spy.mockRestore(),
  };
}

interface HttpResult {
  status: number;
  body: string;
}

function sendHttp(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: options.port,
        method: options.method,
        path: options.path,
        headers: { connection: "close", ...options.headers },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.setTimeout(5000, () => {
      req.destroy(new Error(`timeout ${options.method} ${options.path}`));
    });
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

async function listen(): Promise<{ port: number; address: string; close: () => Promise<void> }> {
  const server = await startHttpTransport();
  const bound = server.address() as AddressInfo | null;
  if (!bound || typeof bound === "string") {
    throw new Error("HTTP server did not bind a TCP port");
  }
  return {
    port: bound.port,
    address: bound.address,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extra,
  };
}

const statusCall = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "xero_status", arguments: {} },
});

function exitSpy() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code)}`);
  }) as typeof process.exit);
}

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  process.env.MCP_HTTP_PORT = "0";
  delete process.env.MCP_HTTP_HOST;
  delete process.env.CONDUIT_S2S_SECRET;
  delete process.env.MCP_ALLOW_INSECURE_DEV;
  delete process.env.AUTH_MODE;
  delete process.env.XERO_ACCESS_TOKEN;
  delete process.env.XERO_TENANT_ID;
  delete process.env.MCP_TRANSPORT;
});

describe("HTTP startup", () => {
  it("refuses to start when CONDUIT_S2S_SECRET is empty", async () => {
    const logs = captureStderr();
    const exit = exitSpy();

    try {
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      expect(exit).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain("Refusing to start HTTP transport");
      expect(text).toContain("CONDUIT_S2S_SECRET is empty");
      expect(text).toContain("MCP_ALLOW_INSECURE_DEV=1");
      expect(text).not.toContain(S2S_SECRET);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it("still refuses when MCP_ALLOW_INSECURE_DEV is not exactly 1", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "true";
    const logs = captureStderr();
    const exit = exitSpy();

    try {
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      expect(logs.text()).toContain("Refusing to start HTTP transport");
      expect(logs.text()).toContain("CONDUIT_S2S_SECRET is empty");
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it.each([
    "replace-with-a-real-secret",
    "your-s2s-secret",
    "changeme",
    "  Your-Secret  ",
    "PLACEHOLDER",
  ])("refuses known placeholder %j and does not log it", async (placeholder) => {
    process.env.CONDUIT_S2S_SECRET = placeholder;
    const logs = captureStderr();
    const exit = exitSpy();

    try {
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      expect(exit).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain("known placeholder");
      expect(text).toContain("openssl rand -hex 32");
      expect(text).not.toContain(placeholder.trim());
      expect(text).not.toContain(S2S_SECRET);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it("refuses a placeholder even when MCP_ALLOW_INSECURE_DEV=1", async () => {
    process.env.CONDUIT_S2S_SECRET = "  Your-S2S-Secret  ";
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    const logs = captureStderr();
    const exit = exitSpy();

    try {
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      expect(logs.text()).toContain("known placeholder");
      expect(logs.text()).not.toContain("Your-S2S-Secret");
      expect(logs.text()).not.toContain("SECURITY WARNING");
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it("allows startup with a warning when MCP_ALLOW_INSECURE_DEV=1 and binds 127.0.0.1", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    const logs = captureStderr();
    let close: (() => Promise<void>) | undefined;
    try {
      const server = await listen();
      close = server.close;
      expect(server.address).toBe("127.0.0.1");
      const text = logs.text();
      expect(text).toContain("SECURITY WARNING");
      expect(text).toContain("CONDUIT_S2S_SECRET");
      expect(text).toContain("MCP_ALLOW_INSECURE_DEV=1");
      expect(text).toContain("127.0.0.1");
      expect(text).not.toContain("not a loopback address");
      expect(text).not.toContain(S2S_SECRET);
    } finally {
      logs.restore();
      await close?.();
    }
  });

  it.each(["0.0.0.0", "10.1.2.3"])(
    "forces 127.0.0.1 when the dev bypass is set and MCP_HTTP_HOST is %s",
    async (host) => {
      process.env.MCP_ALLOW_INSECURE_DEV = "1";
      process.env.MCP_HTTP_HOST = host;
      const logs = captureStderr();
      let close: (() => Promise<void>) | undefined;
      try {
        const server = await listen();
        close = server.close;
        expect(server.address).toBe("127.0.0.1");
        const text = logs.text();
        expect(text).toContain(`MCP_HTTP_HOST=${host} is not a loopback address`);
        expect(text).toContain("Binding 127.0.0.1 only");
        expect(text).not.toContain(S2S_SECRET);
      } finally {
        logs.restore();
        await close?.();
      }
    },
  );

  it("honors a non-loopback MCP_HTTP_HOST when CONDUIT_S2S_SECRET is set", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    const logs = captureStderr();
    const server = await listen();
    try {
      expect(server.address).toBe("0.0.0.0");
      expect(logs.text()).not.toContain("not a loopback address");
      expect(logs.text()).not.toContain(S2S_SECRET);
    } finally {
      logs.restore();
      await server.close();
    }
  });

  it("keeps the 0.0.0.0 default when a secret is set and MCP_HTTP_HOST is unset", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    delete process.env.MCP_HTTP_HOST;
    const server = await listen();
    try {
      expect(server.address).toBe("0.0.0.0");
    } finally {
      await server.close();
    }
  });

  it("honors an explicit loopback MCP_HTTP_HOST when a secret is set", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    const server = await listen();
    try {
      expect(server.address).toBe("127.0.0.1");
    } finally {
      await server.close();
    }
  });
});

describe("HTTP /mcp authentication", () => {
  beforeEach(() => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    process.env.AUTH_MODE = "gateway";
    process.env.XERO_ACCESS_TOKEN = ENV_ACCESS_TOKEN;
    process.env.XERO_TENANT_ID = ENV_TENANT_ID;
  });

  it("returns 401 when the S2S header is missing or invalid and does not log the secret", async () => {
    const logs = captureStderr();
    const runSpy = vi.spyOn(credentialStore, "run");
    const server = await listen();
    try {
      const missing = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({
          "x-xero-access-token": HEADER_ACCESS_TOKEN,
          "x-xero-tenant-id": HEADER_TENANT_ID,
        }),
        body: statusCall,
      });
      const invalid = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({
          "x-gateway-s2s": mintS2sHeader("wrong-secret"),
          "x-xero-access-token": HEADER_ACCESS_TOKEN,
          "x-xero-tenant-id": HEADER_TENANT_ID,
        }),
        body: statusCall,
      });

      expect(missing.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(missing.body).toContain("X-Gateway-S2S");
      expect(invalid.body).toContain("X-Gateway-S2S");
      expect(missing.body).not.toContain(S2S_SECRET);
      expect(invalid.body).not.toContain(S2S_SECRET);
      expect(missing.body).not.toContain(ENV_ACCESS_TOKEN);
      expect(missing.body).not.toContain(ENV_TENANT_ID);
      expect(logs.text()).not.toContain(S2S_SECRET);
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      logs.restore();
      runSpy.mockRestore();
      await server.close();
    }
  });

  it("returns 401 in gateway mode without credential headers and does not use env credentials", async () => {
    const runSpy = vi.spyOn(credentialStore, "run");
    const server = await listen();
    try {
      const response = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({ "x-gateway-s2s": mintS2sHeader(S2S_SECRET) }),
        body: statusCall,
      });

      expect(response.status).toBe(401);
      expect(response.body).toContain("Missing credentials");
      expect(response.body).toContain("X-Xero-Access-Token");
      expect(response.body).toContain("X-Xero-Tenant-Id");
      expect(response.body).not.toContain(ENV_ACCESS_TOKEN);
      expect(response.body).not.toContain(ENV_TENANT_ID);
      expect(response.body).not.toContain(S2S_SECRET);
      expect(runSpy).not.toHaveBeenCalled();

      const partial = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({
          "x-gateway-s2s": mintS2sHeader(S2S_SECRET),
          "x-xero-access-token": HEADER_ACCESS_TOKEN,
        }),
        body: statusCall,
      });
      expect(partial.status).toBe(401);
      expect(partial.body).not.toContain(ENV_TENANT_ID);
      expect(partial.body).not.toContain(HEADER_ACCESS_TOKEN);
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      runSpy.mockRestore();
      await server.close();
    }
  });

  it("accepts a valid S2S header plus credential headers and uses those credentials", async () => {
    const logs = captureStderr();
    const runSpy = vi.spyOn(credentialStore, "run");
    const server = await listen();
    try {
      const response = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({
          "x-gateway-s2s": mintS2sHeader(S2S_SECRET),
          "x-xero-access-token": HEADER_ACCESS_TOKEN,
          "x-xero-tenant-id": HEADER_TENANT_ID,
        }),
        body: statusCall,
      });

      expect(response.status).toBe(200);
      expect(response.body).not.toContain(S2S_SECRET);
      expect(response.body).not.toContain(ENV_ACCESS_TOKEN);
      expect(response.body).not.toContain(ENV_TENANT_ID);
      const payload = JSON.parse(response.body) as {
        result?: { content?: Array<{ text?: string }> };
      };
      const text = payload.result?.content?.[0]?.text ?? "";
      expect(text).toContain(`tenant: ${HEADER_TENANT_ID}`);
      expect(text).not.toContain(ENV_TENANT_ID);
      expect(logs.text()).not.toContain(S2S_SECRET);
      expect(logs.text()).not.toContain(HEADER_ACCESS_TOKEN);
      expect(runSpy).toHaveBeenCalledWith(
        { accessToken: HEADER_ACCESS_TOKEN, tenantId: HEADER_TENANT_ID },
        expect.any(Function),
      );
    } finally {
      logs.restore();
      runSpy.mockRestore();
      await server.close();
    }
  });

  it("serves /health without authentication and without reading credentials", async () => {
    const runSpy = vi.spyOn(credentialStore, "run");
    const server = await listen();
    try {
      const response = await sendHttp({
        port: server.port,
        method: "GET",
        path: "/health",
      });
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body) as { status?: string; authMode?: string };
      expect(body.status).toBe("ok");
      expect(body.authMode).toBe("gateway");
      expect(response.body).not.toContain(S2S_SECRET);
      expect(response.body).not.toContain(ENV_ACCESS_TOKEN);
      expect(response.body).not.toContain(ENV_TENANT_ID);
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      runSpy.mockRestore();
      await server.close();
    }
  });
});
