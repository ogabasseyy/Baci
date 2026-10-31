# MCP 2026-07-28 fixtures

Baci-authored JSON-RPC examples for the Model Context Protocol `2026-07-28`
revision. They are written for Baci's tests; nothing is copied from the MCP
repository, whose licence is mixed.

| | |
| --- | --- |
| Repository | https://github.com/modelcontextprotocol/modelcontextprotocol |
| Tag | `2026-07-28` |
| Commit | `5f5440bb26a62e2cf3440b92da5a667efa03b267` |
| Specification pages | https://modelcontextprotocol.io/specification/2026-07-28/server/tools and https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning |
| Checked | 31 October 2026 |

## What the fixtures follow

- Every request carries `params._meta` with
  `io.modelcontextprotocol/protocolVersion` and
  `io.modelcontextprotocol/clientCapabilities`; both are required. The fixtures
  also send `io.modelcontextprotocol/clientInfo`, which is recommended.
- A `tools/list` result has `resultType: "complete"`, `tools`, and the required
  cache fields `ttlMs` and `cacheScope` (`public` or `private`).
- A `tools/call` result has `resultType: "complete"`, `content`, and optional
  `structuredContent`.
- The tool is Baci's `search_ucp_catalog`. Its `inputSchema` is what Zod emits
  for `searchUcpCatalogInputSchema` in `agentic-ucp-client.ts`, and the call
  result wraps the way `buildUcpToolResponse` in `agentic-ucp-tools.ts` does,
  around a UCP catalog search response in minor units.

## Files

- `tools-list.request.json`, `tools-list.result.json`
- `tools-call.search-ucp-catalog.request.json`,
  `tools-call.search-ucp-catalog.result.json`

`mcp-fixtures.test.ts` in this folder checks the required fields and records one
known gap as an `it.fails` test: the server card still advertises
`2025-06-18` (F40).
