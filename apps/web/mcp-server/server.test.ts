import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

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
const { getResultTools, postMcpJsonRpc, startMcpServer, stopMcpServer } =
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
      'get_product',
      'get_product_variants',
      'get_shipping_quote',
      'get_store_info',
      'search_products',
    ]);
    expect(toolNames).not.toContain('check_order');
    expect(toolNames).not.toContain('check_payment_status');
    expect(toolNames).not.toContain('create_agentic_checkout_session');
    expect(toolNames).not.toContain('generate_payment_account');
    expect(toolNames).not.toContain('search_ucp_catalog');
  });
});
