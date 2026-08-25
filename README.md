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

```bash
MCP_TRANSPORT=http XERO_ACCESS_TOKEN=your-access-token XERO_TENANT_ID=your-tenant-id npm start
```

The server listens on `http://0.0.0.0:8080/mcp` by default.

### Docker

```bash
docker build -t xero-mcp .
docker run -p 8080:8080 \
  -e MCP_TRANSPORT=http \
  -e XERO_ACCESS_TOKEN=your-access-token \
  -e XERO_TENANT_ID=your-tenant-id \
  xero-mcp
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `XERO_ACCESS_TOKEN` | Yes (env mode) | — | Xero OAuth2 access token |
| `XERO_TENANT_ID` | Yes (env mode) | — | Xero tenant ID (organisation) |
| `MCP_TRANSPORT` | No | `stdio` | Transport type: `stdio` or `http` |
| `MCP_HTTP_PORT` | No | `8080` | HTTP server port |
| `MCP_HTTP_HOST` | No | `0.0.0.0` | HTTP server bind address |
| `AUTH_MODE` | No | `env` | Auth mode: `env` or `gateway` |

## Gateway Mode

When `AUTH_MODE=gateway`, credentials are passed per-request via HTTP headers instead of environment variables:

- `X-Xero-Access-Token` — OAuth2 access token
- `X-Xero-Tenant-Id` — Xero tenant ID

This allows a gateway/proxy to manage multi-tenant credentials.

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
