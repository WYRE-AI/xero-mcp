## [Unreleased]

### Fixed

- Align the Node-HTTP transport's `sessionIdGenerator` to `undefined`, matching the Workers transport. Neither transport maintains a session store — both create a fresh `Server` + `Transport` per request — so the previous `() => randomUUID()` on the Node-HTTP side was a copy/paste leftover implying session-stateful behavior that never existed.

### Added

- Interactive invoice card via MCP Apps (SEP-1865): `xero_invoices_get` results render as a rich card in MCP Apps hosts. The card UI ships as a `ui://xero/invoice-card.html` resource (`text/html;profile=mcp-app`) embedded at build time so stdio, Node HTTP, and Cloudflare Workers all serve it identically. Read-only by policy — invoices are financial records, so the card exposes no write actions. Neutral by default, brandable via `window.__BRAND__` injection or `MCP_BRAND_*` env vars.

### Changed

- Publish the package to the GitHub Packages npm registry (`npm.pkg.github.com`) on release: `@semantic-release/npm` `npmPublish` enabled and `publishConfig.registry` set.

### Documentation

- Clarify the one-click "Deploy to Cloudflare Workers" / "Deploy to DigitalOcean" flow: this server depends only on public npm packages, so the cloud builders install without any registry token. Installing the published package from GitHub Packages does require a GitHub PAT with `read:packages` (`export NODE_AUTH_TOKEN=$(gh auth token)`).

## [1.1.2](https://github.com/WYRE-AI/xero-mcp/compare/v1.1.1...v1.1.2) (2026-04-07)


### Bug Fixes

* **ci:** deploy :latest tag, force revision via env var bump ([e6cf309](https://github.com/WYRE-AI/xero-mcp/commit/e6cf309972d8c98a38fa4a1b84139d7164d760be))

## [1.1.1](https://github.com/WYRE-AI/xero-mcp/compare/v1.1.0...v1.1.1) (2026-03-10)


### Bug Fixes

* **ci:** grant contents:write to docker job for MCPB upload ([ba68774](https://github.com/WYRE-AI/xero-mcp/commit/ba68774184d457dd58d9898adae489c4cdd0d799))

# [1.1.0](https://github.com/WYRE-AI/xero-mcp/compare/v1.0.3...v1.1.0) (2026-03-10)


### Features

* **elicitation:** add MCP elicitation support with graceful fallback ([#1](https://github.com/WYRE-AI/xero-mcp/issues/1)) ([168ab60](https://github.com/WYRE-AI/xero-mcp/commit/168ab60d3f2cf95e2fd8e1f485f88221bd225bf8))

## [1.0.3](https://github.com/WYRE-AI/xero-mcp/compare/v1.0.2...v1.0.3) (2026-03-02)


### Bug Fixes

* **ci:** fix broken YAML in Discord notification step ([1ad5af2](https://github.com/WYRE-AI/xero-mcp/commit/1ad5af25973b935103c344a4a54d50c36ec8dc81))
* **ci:** move Discord notification into release workflow ([71759ce](https://github.com/WYRE-AI/xero-mcp/commit/71759ce259ac5705b6dd121f7fc4ce842a5c8ae6))

## [1.0.2](https://github.com/WYRE-AI/xero-mcp/compare/v1.0.1...v1.0.2) (2026-02-26)


### Bug Fixes

* add GitHub Packages auth to Docker builder stage ([38677c0](https://github.com/WYRE-AI/xero-mcp/commit/38677c025cf7925c69b8bb17062b7c3d2fe1e1b9))
* pass GITHUB_TOKEN to Docker build and install deps for MCPB pack ([76de996](https://github.com/WYRE-AI/xero-mcp/commit/76de9961e3003da96abd65ae6f52e9084f69f19e))

## [1.0.1](https://github.com/WYRE-AI/xero-mcp/compare/v1.0.0...v1.0.1) (2026-02-24)


### Bug Fixes

* add semantic-release plugins as devDependencies ([c744141](https://github.com/WYRE-AI/xero-mcp/commit/c74414103f131640a08ce93ba96c7a08b5cd9dfc))
