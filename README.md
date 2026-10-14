# Xero MCP Server

Model Context Protocol (MCP) server for the [Xero Accounting API](https://developer.xero.com/documentation/api/accounting/overview). Enables Claude and other MCP-compatible clients to manage Xero contacts, invoices, payments, accounts, and reports.

## Features

- Contacts, invoices, payments, chart of accounts, and financial reports over stdio, HTTP, or Cloudflare Workers transports
- Interactive invoice card (MCP Apps, SEP-1865): `xero_invoices_get` renders as a rich, read-only card in MCP Apps hosts — neutral by default, brandable via `window.__BRAND__` injection or `MCP_BRAND_*` env vars
- Gateway mode for per-request, multi-tenant credentials

## One-Click Deployment

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/WYRE-AI/xero-mcp/tree/main)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/WYRE-AI/xero-mcp)

> **Note on registry auth:** This server depends only on public npm packages, so the Cloudflare and DigitalOcean cloud builders install its dependencies anonymously — no token is required for one-click deploy. (If a future release adds a private `@wyre-ai/*` dependency, you would supply a GitHub PAT with `read:packages` as a build variable — `NODE_AUTH_TOKEN` for Cloudflare Workers, a build-time `GITHUB_TOKEN` secret for DigitalOcean.)
>
> **Installing the published package:** The released package is published to the [GitHub Packages](https://github.com/WYRE-AI/xero-mcp/pkgs/npm/xero-mcp) npm registry, which requires authentication on every install (even for public packages). To install it, authenticate npm to `npm.pkg.github.com` with a GitHub PAT that has `read:packages`:
>
> ```bash
> export NODE_AUTH_TOKEN=$(gh auth token)
> npm install @wyre-ai/xero-mcp
> ```

## Quick Start

### Prerequisites

- Node.js >= 20
- Xero OAuth2 app credentials (requires a [Xero developer account](https://developer.xero.com/))

### Install and Build

```bash
npm install
npm run build
```

### Run (stdio mode)

```bash
XERO_ACCESS_TOKEN=your-access-token XERO_TENANT_ID=your-tenant-id npm start
```

### Run (HTTP mode)

`CONDUIT_S2S_SECRET` is required. If it is empty or a known placeholder, the process logs an error and exits non-zero. It never prints the secret.

```bash
MCP_TRANSPORT=http \
  CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  XERO_ACCESS_TOKEN=your-access-token \
  XERO_TENANT_ID=your-tenant-id \
  npm start
```

With a secret set and `MCP_HTTP_HOST` unset, the server listens on `http://0.0.0.0:8080/mcp`.

Local HTTP without a secret is development-only. It logs a warning, does not check `X-Gateway-S2S`, and binds `127.0.0.1` only (a non-loopback `MCP_HTTP_HOST` is ignored):

```bash
MCP_TRANSPORT=http MCP_ALLOW_INSECURE_DEV=1 npm start
```

### Docker

The image listens on `0.0.0.0` inside the container. Publish the port on loopback and pass the S2S secret. Gateway mode does not read Xero credentials from the environment:

```bash
docker build -t xero-mcp .
docker run \
  -e CONDUIT_S2S_SECRET=your-s2s-secret \
  -e AUTH_MODE=gateway \
  -p 127.0.0.1:8080:8080 \
  xero-mcp
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses `XERO_ACCESS_TOKEN` and `XERO_TENANT_ID`:

```bash
docker run \
  -e CONDUIT_S2S_SECRET=your-s2s-secret \
  -e AUTH_MODE=env \
  -e XERO_ACCESS_TOKEN=your-access-token \
  -e XERO_TENANT_ID=your-tenant-id \
  -p 127.0.0.1:8080:8080 \
  xero-mcp
```

### Docker Compose

The checked-in Compose service is gateway mode. It does not set `XERO_ACCESS_TOKEN` or `XERO_TENANT_ID` and does not use `env_file`, so a project `.env` cannot inject static vendor credentials into the container. Compose refuses to start when `CONDUIT_S2S_SECRET` is unset or empty, and publishes `127.0.0.1:8080:8080`.

```bash
CONDUIT_S2S_SECRET=your-s2s-secret docker compose up
```

## Environment Variables

Copy [`.env.example`](.env.example). Leave `CONDUIT_S2S_SECRET` empty in that file.

| Variable | Required | Default | Description |
|---|---|---|---|
| `XERO_ACCESS_TOKEN` | For stdio and `AUTH_MODE=env` | — | Xero OAuth2 access token. Not set on the gateway Compose service. |
| `XERO_TENANT_ID` | For stdio and `AUTH_MODE=env` | — | Xero tenant ID (organisation). Not set on the gateway Compose service. |
| `MCP_TRANSPORT` | No | `stdio` | Transport type: `stdio` or `http` |
| `MCP_HTTP_PORT` | No | `8080` | HTTP server port |
| `MCP_HTTP_HOST` | No | `0.0.0.0` when `CONDUIT_S2S_SECRET` is set | Bind address. A configured secret honors this value. With no secret, `MCP_ALLOW_INSECURE_DEV=1` forces `127.0.0.1`. The container image sets `0.0.0.0`. |
| `AUTH_MODE` | No | `env` | `env` or `gateway`. Compose sets `gateway`. |
| `CONDUIT_S2S_SECRET` | Yes for HTTP | — | Service-to-service HMAC secret. HTTP startup exits non-zero when this is empty or a known placeholder. Never commit a real value. The value is never logged. |
| `MCP_ALLOW_INSECURE_DEV` | No | unset | Set to exactly `1` for local HTTP without `CONDUIT_S2S_SECRET`. Logs a warning, skips `X-Gateway-S2S`, and binds `127.0.0.1` only. Does not accept a placeholder secret. |

`/health` stays unauthenticated and does not read credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

## HTTP authentication

With `MCP_TRANSPORT=http` and `CONDUIT_S2S_SECRET` set, every `/mcp` request must include `X-Gateway-S2S`. The check is `verifyS2sHeader` in [`src/s2s-verify.ts`](src/s2s-verify.ts).

The header value is `t=<unix seconds>,v1=<hex>`:

- `<unix seconds>` is the current UTC time.
- `<hex>` is HMAC-SHA256 of the literal string `t=<unix seconds>` (the same `t=` prefix and digits), keyed with `CONDUIT_S2S_SECRET`, encoded as 64 lowercase hex characters.
- The timestamp must be within 300 seconds of the server clock.

A missing or invalid header is HTTP 401, before vendor credentials are read. The secret is never logged.

```bash
TS=$(date +%s)
SIG=$(printf 't=%s' "$TS" | openssl dgst -sha256 -hmac "$CONDUIT_S2S_SECRET" -hex | awk '{print $NF}')
curl -sS http://127.0.0.1:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-Gateway-S2S: t=${TS},v1=${SIG}" \
  -H "X-Xero-Access-Token: $XERO_ACCESS_TOKEN" \
  -H "X-Xero-Tenant-Id: $XERO_TENANT_ID" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Known placeholders (`replace-with-a-real-secret`, `your-s2s-secret`, `your-secret`, `changeme`, `change-me`, `placeholder`, `secret`, `example`, `replace-me`, `s2s-secret`, any case, surrounding whitespace ignored) are refused at startup so a copied example cannot forge that header. Generate a secret with `openssl rand -hex 32`.

## Gateway Mode

When `AUTH_MODE=gateway`, credentials are passed per-request via HTTP headers instead of environment variables:

- `X-Xero-Access-Token` — OAuth2 access token
- `X-Xero-Tenant-Id` — Xero tenant ID

A request missing either header gets HTTP 401 and does not fall back to `XERO_ACCESS_TOKEN` or `XERO_TENANT_ID`. When `CONDUIT_S2S_SECRET` is set, the request must also include a valid `X-Gateway-S2S` header. This allows a gateway/proxy to manage multi-tenant credentials.

## Interactive Invoice Card (MCP Apps)

`xero_invoices_get` renders as an interactive card in MCP Apps hosts
(Claude Desktop/web) showing status, contact, dates, amounts, and line
items; plain-JSON behavior is unchanged in other hosts. The card is
read-only — invoices are financial records, so no write actions are
exposed from it. It is neutral by default and brandable via
`window.__BRAND__` injection or `MCP_BRAND_*` env vars (`MCP_BRAND_NAME`,
`MCP_BRAND_LOGO_URL`, `MCP_BRAND_PRIMARY_COLOR`, `MCP_BRAND_ACCENT_COLOR`,
`MCP_BRAND_BG`, `MCP_BRAND_TEXT`) — no rebuild needed.

## Available Tools

Tools are organized into domains. Use `xero_navigate` to select a domain, then use the domain-specific tools.

### Navigation

- `xero_navigate` — Select a domain (contacts, invoices, payments, accounts, reports)
- `xero_back` — Return to domain selection

### Contacts

- `xero_contacts_list` — List contacts with pagination and optional filtering
- `xero_contacts_get` — Get detailed contact information by ID
- `xero_contacts_create` — Create a new contact (customer or supplier)
- `xero_contacts_search` — Search contacts by name

### Invoices

- `xero_invoices_list` — List invoices with optional status and type filters
- `xero_invoices_get` — Get detailed invoice information by ID
- `xero_invoices_create` — Create a new invoice (sales or bill)
- `xero_invoices_update_status` — Update invoice status (submit, authorise, void)

### Payments

- `xero_payments_list` — List payments with optional status filter
- `xero_payments_get` — Get detailed payment information by ID
- `xero_payments_create` — Record a payment against an invoice

### Accounts

- `xero_accounts_list` — List chart of accounts with optional type/class filter
- `xero_accounts_get` — Get detailed account information by ID

### Reports

- `xero_reports_profit_and_loss` — Profit and Loss (income statement) for a date range
- `xero_reports_balance_sheet` — Balance Sheet as of a specific date
- `xero_reports_aged_receivables` — Aged Receivables by contact
- `xero_reports_aged_payables` — Aged Payables by contact

## License

Apache-2.0
