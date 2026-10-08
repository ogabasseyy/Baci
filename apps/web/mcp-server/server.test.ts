import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';
import { MCP_OPTION_COLOR_EVIDENCE_GUIDANCE } from './option-color-evidence-guidance';
import { PUBLIC_MCP_TOOLS } from '../src/config/mcp-server-card-tools';

const testFileDirectory = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(testFileDirectory, 'server.ts'), 'utf8');
const snippetStartMatch = /^\s*const\s+ESCAPE_HTML_MAP\s*=/m.exec(serverSource);
const snippetStart = snippetStartMatch?.index ?? -1;
const snippetEndMatch =
  snippetStart === -1
    ? null
    : /^\s*const\s+openLink\s*=/m.exec(serverSource.slice(snippetStart));
const snippetEnd =
  snippetStart === -1 || snippetEndMatch === null
    ? -1
    : snippetStart + snippetEndMatch.index;

if (snippetStart === -1 || snippetEnd === -1) {
  throw new Error('Embedded escapeHtml snippet not found in MCP server widget');
}

const escapeHtmlSnippet = serverSource.slice(snippetStart, snippetEnd);
const { getResultRecord, getResultTools, postMcpJsonRpc, startMcpServer, stopMcpServer } =
  mcpServerTestSupport;

function runEmbeddedEscapeHtml(input: unknown) {
  const context: { input: unknown; result?: string } = { input };
  runInNewContext(
    `${escapeHtmlSnippet}\nglobalThis.result = escapeHtml(globalThis.input);`,
    context
  );
  return context.result;
}

describe('MCP widget HTML escaping', () => {
  it('escapes quotes for values interpolated into HTML attributes', () => {
    expect(
      runEmbeddedEscapeHtml('https://img.invalid/a.jpg" onerror="alert(1)')
    ).toBe('https://img.invalid/a.jpg&quot; onerror=&quot;alert(1)');
  });

  it('escapes text, tag, and apostrophe characters consistently', () => {
    expect(runEmbeddedEscapeHtml(`Tom & "Jerry" <tag> 'phone'`)).toBe(
      'Tom &amp; &quot;Jerry&quot; &lt;tag&gt; &#39;phone&#39;'
    );
  });

  it('keeps nullish values empty for existing widget call sites', () => {
    expect(runEmbeddedEscapeHtml(null)).toBe('');
  });
});

const purchaseUrlSnippetStartMatch =
  /^\s*const\s+cartUrl\s*=/m.exec(serverSource);
const purchaseUrlSnippetStart = purchaseUrlSnippetStartMatch?.index ?? -1;
const purchaseUrlSnippetEndMatch =
  purchaseUrlSnippetStart === -1
    ? null
    : /^\s*const\s+renderProducts\s*=/m.exec(
        serverSource.slice(purchaseUrlSnippetStart)
      );
const purchaseUrlSnippetEnd =
  purchaseUrlSnippetStart === -1 || purchaseUrlSnippetEndMatch === null
    ? -1
    : purchaseUrlSnippetStart + purchaseUrlSnippetEndMatch.index;

if (purchaseUrlSnippetStart === -1 || purchaseUrlSnippetEnd === -1) {
  throw new Error(
    'Embedded purchaseUrl snippet not found in MCP server widget'
  );
}

const purchaseUrlSnippet = serverSource.slice(
  purchaseUrlSnippetStart,
  purchaseUrlSnippetEnd
);

function runEmbeddedPurchaseUrl(p: unknown) {
  const context: { URL: typeof URL; p: unknown; result?: string } = {
    URL,
    p,
  };
  runInNewContext(
    `${purchaseUrlSnippet}\nglobalThis.result = purchaseUrl(globalThis.p);`,
    context
  );
  return context.result;
}

describe('MCP widget purchase routing', () => {
  it('opens the option-aware product URL for option-bearing results', () => {
    expect(
      runEmbeddedPurchaseUrl({
        id: 'product-1',
        url: 'https://ogabassey.com/products/phone?condition=used&variantId=variant-9',
      })
    ).toBe(
      'https://ogabassey.com/products/phone?condition=used&variantId=variant-9'
    );
    expect(
      runEmbeddedPurchaseUrl({
        id: 'product-2',
        url: 'https://ogabassey.com/products/phone?condition=new',
      })
    ).toBe('https://ogabassey.com/products/phone?condition=new');
  });

  it('keeps the cart handoff for results without option params', () => {
    expect(
      runEmbeddedPurchaseUrl({
        id: 'product-3',
        url: 'https://ogabassey.com/products/phone',
      })
    ).toBe('https://ogabassey.com/cart?item_id=product-3');
    expect(runEmbeddedPurchaseUrl({ id: 'product-4' })).toBe(
      'https://ogabassey.com/cart?item_id=product-4'
    );
    expect(runEmbeddedPurchaseUrl({ id: 'product-5', url: 'not a url' })).toBe(
      'https://ogabassey.com/cart?item_id=product-5'
    );
  });

  it('routes both purchase buttons through the option-aware URL', () => {
    const matches = serverSource.match(/openLink\(purchaseUrl\(p\)\)/g) ?? [];
    expect(matches).toHaveLength(2);
  });
});

describe('MCP streamable HTTP probe compatibility', () => {
  let serverProcess: ChildProcess | undefined;
  let serverBaseUrl: string;

  beforeAll(async () => {
    const server = await startMcpServer();
    serverProcess = server.process;
    serverBaseUrl = server.baseUrl;
  }, 15_000);

  afterAll(async () => {
    await stopMcpServer(serverProcess);
  });

  it('allows the MCP protocol version header in CORS preflights', async () => {
    const response = await fetch(`${serverBaseUrl}/mcp`, {
      headers: {
        'access-control-request-headers':
          'content-type, mcp-protocol-version',
        'access-control-request-method': 'POST',
        origin: 'https://chatgpt.com',
      },
      method: 'OPTIONS',
    });

    expect(response.status).toBe(204);
    expect(
      response.headers.get('access-control-allow-headers')?.toLowerCase()
    ).toContain('mcp-protocol-version');
  });

  it('responds to HEAD liveness checks on the MCP endpoint', async () => {
    const response = await fetch(`${serverBaseUrl}/mcp`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'HEAD'
    );
  });

  it('reports guest-cart storage state in the readiness probe', async () => {
    const response = await fetch(`${serverBaseUrl}/health`);
    const body = (await response.json()) as Record<string, unknown>;

    // The spawned test server gets a private writable cart directory, so
    // storage reports ok regardless of the database outcome.
    expect(body.guestCarts).toBe('ok');
    expect(body).not.toHaveProperty('guestCartsReason');
  });

  it('publishes product lookup inputs for product detail tools', async () => {
    const payload = await postMcpJsonRpc(serverBaseUrl, {
      id: 1,
      method: 'tools/list',
      params: {},
    });
    const tools = getResultTools(payload);

    for (const toolName of ['get_product', 'get_product_variants']) {
      const tool = tools.find((candidate) => candidate.name === toolName);
      expect(tool?.inputSchema.properties.product_id).toMatchObject({
        maxLength: 80,
        minLength: 1,
        type: 'string',
      });
      expect(tool?.inputSchema.properties.product_name).toMatchObject({
        maxLength: 100,
        minLength: 1,
        type: 'string',
      });
    }
  });

  it('keeps the default ChatGPT tool surface public-only', async () => {
    const payload = await postMcpJsonRpc(serverBaseUrl, {
      id: 2,
      method: 'tools/list',
      params: {},
    });
    const toolNames = getResultTools(payload)
      .map((tool) => tool.name)
      .sort();

    expect(toolNames).toEqual([
      'add_to_cart',
      'browse_categories',
      'get_brands',
      'get_delivery_fee_info',
      'get_product',
      'get_product_variants',
      'get_store_info',
      'prepare_storefront_cart_link',
      'search_products',
      'update_ogabassey_guest_cart',
    ]);
    expect(toolNames).not.toContain('check_order');
    expect(toolNames).not.toContain('check_payment_status');
    expect(toolNames).not.toContain('create_agentic_checkout_session');
    expect(toolNames).not.toContain('generate_payment_account');
    expect(toolNames).not.toContain('search_ucp_catalog');
  });

  it('keeps colour evidence guidance aligned across runtime and server-card tools', async () => {
    const payload = await postMcpJsonRpc(serverBaseUrl, {
      id: 3,
      method: 'tools/list',
      params: {},
    });
    const runtimeTools = getResultTools(payload);
    const optionTools = ['search_products', 'get_product', 'get_product_variants'];

    for (const name of optionTools) {
      const runtimeDescription = runtimeTools.find((tool) => tool.name === name)?.description;
      const cardDescription = PUBLIC_MCP_TOOLS.find((tool) => tool.name === name)?.description;
      expect(runtimeDescription).toContain(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE);
      expect(cardDescription).toContain(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE);
    }
  });

  it('returns checkout-only delivery fee information without inventing a quote', async () => {
    const result = getResultRecord(await postMcpJsonRpc(serverBaseUrl, {
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_delivery_fee_info',
        arguments: { state: 'Lagos', city: 'Ikeja' },
      },
    }));

    expect(result.structuredContent).toMatchObject({
      city: 'Ikeja',
      fee: null,
      policy_url: 'https://ogabassey.com/shipping',
      quote_available: false,
      state: 'Lagos',
      status: 'needs_items',
    });
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('final fee') }),
    ]));
    expect(JSON.stringify(result.content)).not.toMatch(/₦\s*[\d,]+/);
  });
});
