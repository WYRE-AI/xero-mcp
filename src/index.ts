#!/usr/bin/env node
/**
 * Xero MCP Server
 *
 * This MCP server provides tools for interacting with the Xero Accounting API.
 * All tools are listed upfront so they work with every MCP client, including
 * remote connectors (claude.ai, mcp-remote) that do not support dynamic
 * tool-list changes. A helper `xero_navigate` tool provides domain
 * discovery and guidance.
 *
 * Supports both stdio and HTTP (StreamableHTTP) transports.
 * Authentication:
 *   - Gateway mode: Read X-Xero-Access-Token and X-Xero-Tenant-Id headers.
 *     Missing headers are rejected. Gateway mode never falls back to XERO_*.
 *   - Env mode: Read XERO_ACCESS_TOKEN and XERO_TENANT_ID environment variables
 * HTTP transport refuses to start unless CONDUIT_S2S_SECRET is a real secret.
 * Known placeholders are rejected. MCP_ALLOW_INSECURE_DEV=1 is local-only:
 * it skips X-Gateway-S2S and listens on 127.0.0.1 only.
 * /health stays unauthenticated and does not read credentials.
 * stdio does not use S2S auth.
 * Rate Limit: 60 requests/minute, 5000/day
 */

import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { credentialStore } from "./utils/client.js";
import {
  createMcpServer,
  resolveGatewayCredentials,
} from "./mcp-server.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";

/**
 * Public example values. A copied placeholder must not verify as a real
 * secret: anyone who has read the docs could forge X-Gateway-S2S.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-real-secret",
  "your-s2s-secret",
  "your-secret",
  "changeme",
  "change-me",
  "placeholder",
  "secret",
  "example",
  "replace-me",
  "s2s-secret",
]);

const LOOPBACK_HOST = "127.0.0.1";

const MISSING_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty. " +
  "Set CONDUIT_S2S_SECRET to the gateway-provisioned secret (openssl rand -hex 32), " +
  "or set MCP_ALLOW_INSECURE_DEV=1 for local development only.";

const PLACEHOLDER_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. " +
  "Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value.";

const INSECURE_DEV_WARNING =
  "SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. " +
  "HTTP /mcp is not enforcing X-Gateway-S2S and listens on 127.0.0.1 only. " +
  "Do not use this outside local development.";

const S2S_UNAUTHORIZED = {
  error:
    "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
};

function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, "$1");
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Secret for X-Gateway-S2S on /mcp. Read when HTTP starts, not at module load.
 * Empty is fail-closed unless MCP_ALLOW_INSECURE_DEV=1. A known placeholder
 * always refuses to start, including when that flag is set. The secret value
 * is never written to logs.
 */
function resolveHttpS2sSecret(): string {
  const secret = (process.env.CONDUIT_S2S_SECRET ?? "").trim();
  if (secret && KNOWN_PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    console.error(PLACEHOLDER_S2S_SECRET_ERROR);
    process.exit(1);
  }
  if (secret) return secret;

  if (process.env.MCP_ALLOW_INSECURE_DEV === "1") {
    console.error(INSECURE_DEV_WARNING);
    return "";
  }

  console.error(MISSING_S2S_SECRET_ERROR);
  process.exit(1);
}

/**
 * No secret (only reachable via the insecure-dev bypass) always binds
 * 127.0.0.1, even if MCP_HTTP_HOST is a wider address. A configured secret
 * keeps honoring MCP_HTTP_HOST, including the historical 0.0.0.0 default.
 */
function resolveListenHost(s2sSecret: string): string {
  const configured = (process.env.MCP_HTTP_HOST ?? "").trim();
  if (!s2sSecret) {
    if (configured && !isLoopbackBindHost(configured)) {
      console.error(
        `WARNING: MCP_HTTP_HOST=${configured} is not a loopback address. ` +
          "MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET cannot listen there. " +
          `Binding ${LOOPBACK_HOST} only.`,
      );
    }
    return LOOPBACK_HOST;
  }
  return configured || "0.0.0.0";
}

/**
 * Transport and auth configuration types
 */
type TransportType = "stdio" | "http";
type AuthMode = "env" | "gateway";

/**
 * Start the server with stdio transport (default)
 */
async function startStdioTransport(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Xero MCP server running on stdio (flattened mode)");
}

/**
 * Start the server with HTTP Streamable transport.
 * Each request gets a fresh Server + Transport (stateless).
 * Returns the listener so tests can close it. Signal handlers stay in main().
 */
export async function startHttpTransport(): Promise<HttpServer> {
  const s2sSecret = resolveHttpS2sSecret();
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = resolveListenHost(s2sSecret);
  const authMode = (process.env.AUTH_MODE as AuthMode) || "env";
  const isGatewayMode = authMode === "gateway";

  const httpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`
      );

      // Health endpoint — unauthenticated liveness. Do not read credentials.
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            transport: "http",
            authMode: isGatewayMode ? "gateway" : "env",
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      // MCP endpoint
      if (url.pathname === "/mcp") {
        // Conduit service-to-service auth (gateway#377 parity): rejected
        // BEFORE any credential extraction, mirroring every other ported
        // wrapper (e.g. containers/sentinelone-mcp/gateway_wrapper.py).
        // Empty s2sSecret is only reachable when MCP_ALLOW_INSECURE_DEV=1.
        if (
          s2sSecret &&
          !verifyS2sHeader(singleHeader(req.headers[S2S_HEADER]), s2sSecret)
        ) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify(S2S_UNAUTHORIZED));
          return;
        }

        // In gateway mode, extract credentials and bind them to the
        // request's async context — no process.env mutation. The promise
        // returned to AsyncLocalStorage.run keeps that context until the
        // tool call finishes.
        const handleMcp = async (): Promise<void> => {
          const server = createMcpServer();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });

          res.on("close", () => {
            transport.close();
            server.close();
          });

          await server.connect(transport);
          await transport.handleRequest(req, res);
        };

        const onMcpError = (error: unknown) => {
          console.error(
            "MCP request failed:",
            error instanceof Error ? error.message : String(error),
          );
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        };

        if (isGatewayMode) {
          const { creds, error } = resolveGatewayCredentials((name) => {
            const value = req.headers[name];
            if (typeof value !== "string") return undefined;
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : undefined;
          });
          if (error || !creds) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Missing credentials",
                message: error,
                required: ["X-Xero-Access-Token", "X-Xero-Tenant-Id"],
              })
            );
            return;
          }
          void credentialStore.run(creds, () => handleMcp().catch(onMcpError));
        } else {
          void handleMcp().catch(onMcpError);
        }
        return;
      }

      // 404 for everything else
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Not found",
          endpoints: ["/mcp", "/health"],
        })
      );
    }
  );

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.error(
        `Xero MCP server listening on http://${host}:${port}/mcp`
      );
      console.error(
        `Health check available at http://${host}:${port}/health`
      );
      console.error(
        `Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env (environment variables)"}`
      );
      resolve();
    });
  });

  return httpServer;
}

/**
 * Main entry point - selects transport based on MCP_TRANSPORT env var
 */
async function main() {
  const transportType =
    (process.env.MCP_TRANSPORT as TransportType) || "stdio";

  if (transportType === "http") {
    const httpServer = await startHttpTransport();
    const shutdown = async () => {
      console.error("Shutting down Xero MCP server...");
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    await startStdioTransport();
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// Vitest imports this module to call startHttpTransport. Skip the CLI
// entrypoint there. `node dist/index.js` still starts stdio or HTTP.
if (process.env.VITEST !== "true") {
  main().catch(console.error);
}
