import { afterEach, expect, it, vi } from 'vitest';

const { host, factory } = vi.hoisted(() => {
  const host = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({}),
    getHostContext: vi.fn(() => ({
      theme: 'light',
      availableDisplayModes: ['inline', 'fullscreen'],
    })),
    getHostCapabilities: vi.fn(() => ({
      serverTools: {},
      openLinks: {},
      message: { text: {} },
    })),
    callServerTool: vi.fn().mockResolvedValue({ content: [] }),
    openLink: vi.fn(),
    requestDisplayMode: vi.fn(),
    sendSizeChanged: vi.fn(),
    ontoolcancelled: undefined as undefined | (() => void),
    ontoolresult: undefined as
      | undefined
      | ((v: {
          structuredContent?: unknown;
          isError?: boolean;
          _meta?: Record<string, unknown>;
        }) => void),
    ontoolinput: undefined as undefined | ((v: { arguments: unknown }) => void),
    onhostcontextchanged: undefined as
      | undefined
      | ((v: {
          theme: string;
          safeAreaInsets?: {
            top: number;
            right: number;
            bottom: number;
            left: number;
          };
        }) => void),
  };
  return {
    host,
    factory: vi.fn(function () {
      return host;
    }),
  };
});
vi.mock('@modelcontextprotocol/ext-apps/app-with-deps', () => ({
  App: factory,
}));

import { initializeMcpApp } from './initialize-mcp-app';
import { connectMcpApp } from './mcp-app-bridge';
import { widgetHost } from './widget-host';

afterEach(() => {
  widgetHost.reset();
  delete window.openai;
  vi.clearAllMocks();
});
it('prefers the standard bridge while retaining ChatGPT state persistence', async () => {
  const bridge = {
    callTool: vi.fn(),
    widgetState: { cart: [] },
    setWidgetState: vi.fn(),
  };
  window.openai = bridge;
  await connectMcpApp();
  expect(factory).toHaveBeenCalledWith(
    { name: 'Ogabassey catalog', version: '1.0.0' },
    { availableDisplayModes: ['inline', 'fullscreen'] },
    { autoResize: false }
  );
  expect(host.connect).toHaveBeenCalledWith(undefined, { timeout: 10000 });
  expect(window.openai).toBe(bridge);
  expect(widgetHost.get()?.widgetState).toBe(bridge.widgetState);
  widgetHost.get()?.setWidgetState?.({ cart: ['phone'] });
  expect(bridge.setWidgetState).toHaveBeenCalledWith({ cart: ['phone'] });
  await widgetHost.get()?.callTool?.('get_product', { product_id: 'phone' });
  expect(bridge.callTool).not.toHaveBeenCalled();
  expect(host.callServerTool).toHaveBeenCalledWith({
    name: 'get_product',
    arguments: { product_id: 'phone' },
  });
});
it('delivers standard tool results, deferred arguments and host theme changes', async () => {
  await connectMcpApp();
  host.ontoolresult?.({ structuredContent: { products: [{ id: 'phone' }] } });
  expect(widgetHost.get()?.toolOutput).toEqual({ products: [{ id: 'phone' }] });
  host.ontoolinput?.({ arguments: { product_ids: ['phone'] } });
  expect(widgetHost.get()?.toolInput).toEqual({ product_ids: ['phone'] });
  host.onhostcontextchanged?.({ theme: 'dark' });
  expect(widgetHost.get()?.theme).toBe('dark');
  await widgetHost.get()?.callTool?.('update_ogabassey_guest_cart', {
    quantity: 1,
  });
  expect(host.callServerTool).toHaveBeenCalledWith({
    name: 'update_ogabassey_guest_cart',
    arguments: { quantity: 1 },
  });
});

it('shows a safe error when a tool result has no structured content', async () => {
  await connectMcpApp();
  host.ontoolresult?.({ isError: true });

  expect(widgetHost.get()?.toolOutput).toEqual({
    status: 'error',
    products: [],
    message: 'Product results could not be displayed. Please search again.',
  });
});

it('clears displayed products after host cancellation', async () => {
  await connectMcpApp();
  host.ontoolcancelled?.();
  expect(widgetHost.get()?.toolOutput).toMatchObject({
    status: 'error',
    products: [],
  });
});
it('shows a safe fallback when the standard handshake fails', async () => {
  host.connect.mockRejectedValueOnce(new Error('private transport details'));
  await initializeMcpApp();
  expect(widgetHost.get()?.toolOutput).toMatchObject({
    status: 'error',
    products: [],
  });
  expect(JSON.stringify(widgetHost.get()?.toolOutput)).not.toContain(
    'private transport'
  );
});

it('uses the existing legacy bridge only when standard initialization fails', async () => {
  const bridge = {
    callTool: vi.fn(),
    widgetState: { cart: ['saved'] },
    toolOutput: { products: [{ id: 'phone' }] },
  };
  window.openai = bridge;
  host.connect.mockRejectedValueOnce(new Error('unsupported protocol'));
  await initializeMcpApp();
  expect(widgetHost.get()).toBe(bridge);
  expect(host.close).toHaveBeenCalled();
});

it('shows a connection error for a callTool-only bridge with no delivered result', async () => {
  window.openai = { callTool: vi.fn() };
  host.connect.mockRejectedValueOnce(new Error('unsupported'));
  await initializeMcpApp();
  expect(widgetHost.get()?.toolOutput).toMatchObject({
    status: 'error',
    products: [],
  });
});
it('supports follow-up messages and local state without ChatGPT extensions', async () => {
  await connectMcpApp();
  widgetHost.get()?.setWidgetState?.({ cart: ['phone'] });
  expect(widgetHost.get()?.widgetState).toEqual({ cart: ['phone'] });
  widgetHost.get()?.sendFollowUpMessage?.({ prompt: 'Compare these phones' });
  expect(host.sendMessage).toHaveBeenCalledWith({
    role: 'user',
    content: [{ type: 'text', text: 'Compare these phones' }],
  });
});

it('maps standard response metadata and safe areas without changing the native bridge', async () => {
  const native = { theme: 'light' };
  window.openai = native;
  await connectMcpApp();
  host.ontoolresult?.({
    structuredContent: { products: [] },
    _meta: { source: 'catalog' },
  });
  expect(widgetHost.get()?.toolResponseMetadata).toEqual({ source: 'catalog' });
  const insets = { top: 1, right: 2, bottom: 3, left: 4 };
  host.onhostcontextchanged?.({ theme: 'dark', safeAreaInsets: insets });
  expect(widgetHost.get()?.safeArea).toEqual({ insets });
  expect(native).toEqual({ theme: 'light' });
});

it('does not advertise unsupported tool calls or fullscreen', async () => {
  host.getHostCapabilities.mockReturnValueOnce(
    {} as ReturnType<typeof host.getHostCapabilities>
  );
  host.getHostContext.mockReturnValueOnce({
    theme: 'light',
    availableDisplayModes: ['inline'],
  });
  await connectMcpApp();
  expect(widgetHost.get()?.callTool).toBeUndefined();
  expect(widgetHost.get()?.requestDisplayMode).toBeUndefined();
});
it.each([
  'denied',
  'transport',
])('surfaces %s link failures without an unhandled rejection', async (failure) => {
  host.openLink.mockImplementationOnce(() =>
    failure === 'denied'
      ? Promise.resolve({ isError: true })
      : Promise.reject(new Error('private error'))
  );
  await connectMcpApp();
  await widgetHost
    .get()
    ?.openExternal?.({ href: 'https://ogabassey.com/cart' });
  expect(widgetHost.get()?.hostError).toContain('Could not open');
});

it('retains a display-only legacy result when the standard handshake fails', async () => {
  const bridge = {
    toolOutput: { products: [{ id: 'phone' }] },
    openExternal: vi.fn(),
  };
  window.openai = bridge;
  host.connect.mockRejectedValueOnce(new Error('unsupported'));
  await initializeMcpApp();
  expect(widgetHost.get()).toBe(bridge);
  expect(widgetHost.get()?.toolOutput).toBe(bridge.toolOutput);
});
it('retains results delivered during a failed handshake', async () => {
  host.connect.mockImplementationOnce(async () => {
    host.ontoolresult?.({ structuredContent: { products: [{ id: 'phone' }] } });
    throw new Error('disconnect');
  });
  await initializeMcpApp();
  expect(widgetHost.get()?.toolOutput).toEqual({ products: [{ id: 'phone' }] });
});
it('does not expose unsupported link or message methods', async () => {
  host.getHostCapabilities.mockReturnValueOnce(
    {} as ReturnType<typeof host.getHostCapabilities>
  );
  await connectMcpApp();
  expect(widgetHost.get()?.openExternal).toBeUndefined();
  expect(widgetHost.get()?.sendFollowUpMessage).toBeUndefined();
});
it.each([
  'denied',
  'transport',
])('surfaces %s follow-up failures safely', async (failure) => {
  host.sendMessage.mockImplementationOnce(() =>
    failure === 'denied'
      ? Promise.resolve({ isError: true })
      : Promise.reject(new Error('private details'))
  );
  await connectMcpApp();
  await widgetHost.get()?.sendFollowUpMessage?.({ prompt: 'Negotiate' });
  expect(widgetHost.get()?.hostError).toContain('Could not send');
  expect(widgetHost.get()?.hostError).not.toContain('private');
});
it('handles rejected display-mode and sizing calls without unhandled rejections', async () => {
  host.requestDisplayMode.mockRejectedValueOnce(new Error('private details'));
  host.sendSizeChanged.mockRejectedValueOnce(new Error('private details'));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await connectMcpApp();
  await widgetHost.get()?.requestDisplayMode?.({ mode: 'fullscreen' });
  await widgetHost.get()?.notifyIntrinsicHeight?.(300);
  expect(widgetHost.get()?.hostError).toContain('Could not expand');
  expect(warning).toHaveBeenCalledWith(
    'Ogabassey widget size notification failed.'
  );
  warning.mockRestore();
});

it('publishes the display mode granted by the host', async () => {
  host.requestDisplayMode.mockResolvedValueOnce({ mode: 'fullscreen' });
  await connectMcpApp();

  await widgetHost.get()?.requestDisplayMode?.({ mode: 'fullscreen' });

  expect(widgetHost.get()?.displayMode).toBe('fullscreen');
});

it('shows a connection error for navigation-only extensions with no delivered result', async () => {
  window.openai = { openExternal: vi.fn(), setWidgetState: vi.fn() };
  host.connect.mockRejectedValueOnce(new Error('unsupported'));
  await initializeMcpApp();
  expect(widgetHost.get()?.toolOutput).toMatchObject({
    status: 'error',
    products: [],
  });
});

