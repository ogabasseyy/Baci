import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

type JsonRpcResponse = { result?: unknown };

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: { properties: Record<string, unknown> };
}

interface StartedMcpServer {
  baseUrl: string;
  process: ChildProcessWithoutNullStreams;
}

const webRootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRootDirectory = dirname(dirname(webRootDirectory));
const tsxExecutable = join(
  repoRootDirectory, 'node_modules/.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
);

async function postMcpJsonRpc(
  serverBaseUrl: string,
  request: { id: number; method: string; params: Record<string, unknown> }
): Promise<JsonRpcResponse> {
  const response = await fetch(`${serverBaseUrl}/mcp`, {
    body: JSON.stringify({ jsonrpc: '2.0', ...request }),
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
    },
    method: 'POST',
  });
  expect(response.status).toBe(200);
  return (await response.json()) as JsonRpcResponse;
}

function getResultTools(payload: JsonRpcResponse): McpToolDefinition[] {
  const result = payload.result;
  if (!result || typeof result !== 'object' || !('tools' in result)) {
    throw new Error('MCP tools/list response did not include tools');
  }
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) {
    throw new Error('MCP tools/list response tools field was not an array');
  }
  return tools as McpToolDefinition[];
}

function getResultRecord(payload: JsonRpcResponse): Record<string, unknown> {
  if (!payload.result || typeof payload.result !== 'object') {
    throw new Error('MCP response did not include a result object');
  }
  return payload.result as Record<string, unknown>;
}

async function startPostgrestStub() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== 'Bearer test-anon-key') {
      response.statusCode = 403;
      response.end(JSON.stringify({ message: 'Expected anonymous client' }));
      return;
    }
    if (url.pathname.endsWith('/rest/v1/orders') || url.pathname.endsWith('/rest/v1/chat_orders')) {
      response.statusCode = 403;
      response.end(JSON.stringify({ message: 'Private tables are unavailable' }));
      return;
    }
    if (url.pathname.endsWith('/rest/v1/merchants')) {
      response.end(JSON.stringify({ id: 'merchant-1' }));
      return;
    }
    if (url.pathname.endsWith('/rest/v1/products')) {
      if (url.searchParams.get('id') === 'eq.available-product') {
        response.end(JSON.stringify({ id: 'available-product', name: 'Test Phone', slug: 'test-phone', price: 100000, manage_stock: false }));
      } else if (url.searchParams.get('id') === 'eq.sold-out-product') {
        response.end(JSON.stringify({ id: 'sold-out-product', name: 'Sold Out Phone', slug: 'sold-out-phone', price: 100000, manage_stock: true, stock_quantity: 0, has_variants: false }));
      } else if (url.searchParams.get('id') === 'eq.variant-sold-out-product') {
        response.end(JSON.stringify({ id: 'variant-sold-out-product', name: 'Variant Sold Out Phone', slug: 'variant-sold-out-phone', price: 100000, manage_stock: true, stock_quantity: 0, has_variants: true }));
      } else if (url.searchParams.get('id') === 'eq.variant-available-product') {
        response.end(JSON.stringify({ id: 'variant-available-product', name: 'Variant Available Phone', slug: 'variant-available-phone', price: 100000, manage_stock: true, stock_quantity: 0, has_variants: true }));
      } else if (url.searchParams.get('id') === 'eq.untracked-offer-product') {
        response.end(JSON.stringify({ id: 'untracked-offer-product', name: 'Untracked Offer Phone', slug: 'untracked-offer-phone', price: 100000, manage_stock: false, stock_quantity: 0, has_condition_offers: true }));
      } else if (url.searchParams.get('id') === 'eq.legacy-stock-product') {
        response.end(JSON.stringify({ id: 'legacy-stock-product', name: 'Legacy Stock Phone', slug: 'legacy-stock-phone', price: 100000, manage_stock: true, stock_quantity: 0, stock: 3, has_variants: false }));
      } else if (url.searchParams.get('id') === 'eq.condition-offer-product') {
        response.end(JSON.stringify({ id: 'condition-offer-product', name: 'Used Offer Phone', slug: 'used-offer-phone', price: 100000, manage_stock: true, stock_quantity: 0, stock: 0, has_variants: false, has_condition_offers: true }));
      } else if (url.searchParams.get('id') === 'eq.untracked-variant-product') {
        response.end(JSON.stringify({ id: 'untracked-variant-product', name: 'Untracked Variant Phone', slug: 'untracked-variant-phone', price: 100000, manage_stock: false, stock_quantity: 0, has_variants: true }));
      } else if (!url.searchParams.has('id') && !url.searchParams.has('name')) {
        response.end(JSON.stringify([
          { id: 'available-product', name: 'Test Phone', slug: 'test-phone', price: 100000, compare_at_price: 120000, images: ['https://images.example.test/phone.jpg'], manage_stock: false, stock_quantity: 0, has_variants: false },
          { id: 'avif-product', name: 'AVIF Phone', slug: 'avif-phone', price: 120000, images: ['https://cdn.ogabassey.com/core-assets/products/redmi-15-midnight-black.avif'], manage_stock: false, stock_quantity: 0, has_variants: false },
          { id: 'object-image-product', name: 'Object Image Phone', slug: 'object-image-phone', price: 130000, images: [{ url: 'https://cdn.ogabassey.com/core-assets/products/redmi-15-midnight-black.avif' }], manage_stock: false, stock_quantity: 0, has_variants: false },
        ]));
      } else {
        response.statusCode = 406;
        response.end(JSON.stringify({ code: 'PGRST116', message: 'No rows' }));
      }
      return;
    }
    if (url.pathname.endsWith('/rest/v1/product_variants')) {
      response.end(JSON.stringify([{ attributes: { storage: '128GB' }, price_override: 100000, stock_quantity: 0, condition: 'new', sku: 'TEST-128' }]));
      return;
    }
    if (url.pathname.endsWith('/rest/v1/rpc/get_storefront_product_variants')) {
      const rows = [
        { product_id: 'available-product', attributes: { storage: '128GB' }, price_override: 100000, stock_quantity: 0, condition: 'new', sku: 'TEST-128' },
        { product_id: 'variant-sold-out-product', attributes: { storage: '128GB' }, stock_quantity: 0 },
        { product_id: 'variant-available-product', attributes: { storage: '256GB' }, stock_quantity: 2 },
        { product_id: 'untracked-variant-product', attributes: { storage: '128GB' }, stock_quantity: 0 },
      ];
      let body = '';
      request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      request.on('end', () => {
        const requested = JSON.parse(body) as { p_product_ids?: string[] };
        response.end(JSON.stringify(rows.filter((row) => requested.p_product_ids?.includes(row.product_id))));
      });
      return;
    }
    if (url.pathname.endsWith('/rest/v1/rpc/get_product_offers')) {
      let body = '';
      request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      request.on('end', () => {
        const requested = JSON.parse(body) as { p_product_id?: string };
        response.end(JSON.stringify(requested.p_product_id === 'untracked-offer-product'
          ? [{ condition: 'used', price: 80000, stock_quantity: 0, grade: 'A', condition_notes: null }]
          : []));
      });
      return;
    }
    if (url.pathname.endsWith('/rest/v1/product_offers')) {
      response.end('[]');
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('PostgREST stub did not bind a TCP port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function startMcpServerWithPostgrest(
  envOverrides: NodeJS.ProcessEnv
): Promise<StartedMcpServer & { close: () => Promise<void> }> {
  const postgrest = await startPostgrestStub();
  let server: StartedMcpServer;
  try {
    server = await startMcpServer({
      ...envOverrides,
      NEXT_PUBLIC_SUPABASE_URL: postgrest.baseUrl,
    });
  } catch (error) {
    await postgrest.close();
    throw error;
  }
  return {
    ...server,
    close: async () => {
      try {
        await stopMcpServer(server.process);
      } finally {
        await postgrest.close();
      }
    },
  };
}

async function startMcpServer(
  envOverrides: NodeJS.ProcessEnv = {}
): Promise<StartedMcpServer> {
  const serverProcess = spawn(tsxExecutable, ['mcp-server/server.ts'], {
    cwd: webRootDirectory,
    env: buildMcpServerEnv(envOverrides),
  });
  try {
    const port = await waitForMcpServerStartup(serverProcess);
    return { baseUrl: `http://127.0.0.1:${port}`, process: serverProcess };
  } catch (error) {
    await stopMcpServer(serverProcess);
    throw error;
  }
}

function buildMcpServerEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MCP_AGENTIC_CHECKOUT_BASE_URL: 'https://ogabassey.test',
    MCP_PORT: '0',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    OPENAI_AGENTIC_API_KEY: 'test-agentic-key',
    OPENAI_AGENTIC_SIGNING_KEY: 'test-signing-key',
    PAYSTACK_SECRET_KEY: 'test-paystack-key',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS')) {
    delete env.MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS;
  }
  if (!Object.hasOwn(overrides, 'MCP_ENABLE_ORDER_PAYMENT_TOOLS')) {
    delete env.MCP_ENABLE_ORDER_PAYMENT_TOOLS;
  }
  if (!Object.hasOwn(overrides, 'AGENTIC_PAYSTACK_DVA_MODE')) {
    delete env.AGENTIC_PAYSTACK_DVA_MODE;
  }
  return env;
}

async function waitForMcpServerStartup(
  child: ChildProcessWithoutNullStreams
): Promise<number> {
  let stderr = '';
  let stdout = '';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for MCP server startup: stdout=${stdout} stderr=${stderr}`
        )
      );
    }, 10_000);
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const startupMatch = /\{[^\n]*"event":"startup"[^\n]*\}/.exec(stdout);
      if (!startupMatch) return;
      const startupEvent = JSON.parse(startupMatch[0]) as { port?: unknown };
      if (typeof startupEvent.port !== 'number' || startupEvent.port <= 0) {
        reject(new Error(`MCP server reported invalid startup port: ${stdout}`));
        return;
      }
      clearTimeout(timeout);
      resolve(startupEvent.port);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `MCP server exited before startup: code=${code ?? 'null'} signal=${signal ?? 'null'} stdout=${stdout} stderr=${stderr}`
        )
      );
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function stopMcpServer(
  child: ReturnType<typeof spawn> | undefined
): Promise<void> {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

export const mcpServerTestSupport = {
  buildMcpServerEnv,
  getResultRecord,
  getResultTools,
  postMcpJsonRpc,
  startMcpServer,
  startMcpServerWithPostgrest,
  stopMcpServer,
} as const;
