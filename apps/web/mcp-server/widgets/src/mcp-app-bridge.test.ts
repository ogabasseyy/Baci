import { afterEach, expect, it, vi } from 'vitest';
const { host, factory } = vi.hoisted(() => {
  const host = {
    connect: vi.fn().mockResolvedValue(undefined),
    getHostContext: () => ({ theme: 'light' }),
    callServerTool: vi.fn().mockResolvedValue({ content: [] }),
    openLink: vi.fn(),
    requestDisplayMode: vi.fn(),
    sendSizeChanged: vi.fn(),
    ontoolcancelled: undefined as undefined | (() => void),
    ontoolresult: undefined as
      | undefined
      | ((v: { structuredContent: unknown }) => void),
    ontoolinput: undefined as undefined | ((v: { arguments: unknown }) => void),
    onhostcontextchanged: undefined as
      | undefined
      | ((v: { theme: string }) => void),
  };
  return {
    host,
    factory: vi.fn(function () {
      return host;
    }),
  };
});
vi.mock('@modelcontextprotocol/ext-apps', () => ({ App: factory }));
import { connectMcpApp, initializeMcpApp } from './mcp-app-bridge';
afterEach(() => {
  delete window.openai;
  vi.clearAllMocks();
});
it('preserves an existing ChatGPT bridge and its state', async () => {
  const bridge = { callTool: vi.fn(), widgetState: { cart: [] } };
  window.openai = bridge;
  await connectMcpApp();
  expect(window.openai).toBe(bridge);
  expect(factory).not.toHaveBeenCalled();
});
it('delivers standard tool results, deferred arguments and host theme changes', async () => {
  await connectMcpApp();
  host.ontoolresult?.({ structuredContent: { products: [{ id: 'phone' }] } });
  expect(window.openai?.toolOutput).toEqual({ products: [{ id: 'phone' }] });
  host.ontoolinput?.({ arguments: { product_ids: ['phone'] } });
  expect(window.openai?.toolInput).toEqual({ product_ids: ['phone'] });
  host.onhostcontextchanged?.({ theme: 'dark' });
  expect(window.openai?.theme).toBe('dark');
  await window.openai?.callTool?.('update_ogabassey_guest_cart', {
    quantity: 1,
  });
  expect(host.callServerTool).toHaveBeenCalledWith({
    name: 'update_ogabassey_guest_cart',
    arguments: { quantity: 1 },
  });
});

it('clears displayed products after host cancellation', async () => {
  await connectMcpApp();
  host.ontoolcancelled?.();
  expect(window.openai?.toolOutput).toMatchObject({
    status: 'error',
    products: [],
  });
});
it('shows a safe fallback when the standard handshake fails', async () => {
  host.connect.mockRejectedValueOnce(new Error('private transport details'));
  await initializeMcpApp();
  expect(window.openai?.toolOutput).toMatchObject({
    status: 'error',
    products: [],
  });
  expect(JSON.stringify(window.openai?.toolOutput)).not.toContain(
    'private transport',
  );
});
