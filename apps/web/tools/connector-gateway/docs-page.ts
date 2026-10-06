/** Public, static operator-facing documentation for Muse connector setup. */

export const GATEWAY_DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Baci Merchant Connector API</title>
  <style>
    :root { color-scheme: light; font: 16px/1.6 system-ui, sans-serif; }
    body { max-width: 56rem; margin: 3rem auto; padding: 0 1.25rem; color: #20233f; }
    h1, h2 { line-height: 1.2; }
    code { background: #f2f3f8; padding: .12rem .35rem; border-radius: .25rem; }
    a { color: #343783; }
    .notice { padding: 1rem; background: #f8f5e9; border-left: .25rem solid #e7b842; }
  </style>
</head>
<body>
  <h1>Baci Merchant Connector</h1>
  <p>This API gives a connected AI agent read-only access to the Baci merchant
  store selected by the merchant owner. Each agent has its own revocable,
  scope-limited API key.</p>
  <p><strong>OpenAPI specification:</strong> <a href="/openapi.json">/openapi.json</a></p>
  <h2>Authentication</h2>
  <p>Send the agent-specific key in the <code>Authorization: Bearer …</code>
  header. Enter keys only in the AI provider's secure credential field. Never
  include a key in a prompt, URL, or support request.</p>
  <h2>Available operations</h2>
  <ul>
    <li><code>POST /v0/tools/orders.list</code> — list visible orders and their
      separate payment and shipping statuses.</li>
    <li><code>POST /v0/tools/orders.get</code> — read one order visible to the
      connected merchant and branches.</li>
    <li><code>POST /v0/tools/inventory.levels</code> — read visible stock levels
      and low-stock signals.</li>
    <li><code>POST /v0/tools/analytics.summary</code> — read merchant-scoped
      order, revenue, shipping, and stock aggregates. Revenue is grouped in
      <code>paidRevenueByCurrency</code>; the scalar total is null for mixed or
      unknown currencies.</li>
  </ul>
  <h2>Access and safety</h2>
  <p>All operations are read-only. They cannot create or change orders,
  products, inventory, payments, refunds, or store settings. Merchant and
  branch access is determined by the active grant and rechecked on each call.
  Request selectors can narrow that access but cannot expand it. Disconnecting
  an agent revokes its grant independently.</p>
  <p>Invalid or expired credentials are denied. Scope violations do not return
  out-of-scope merchant data. Errors use a JSON object with <code>error</code>
  and <code>code</code> fields.</p>
</body>
</html>`;
