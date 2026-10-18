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
          structuredContent: unknown;
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
import { getWidgetHost, resetWidgetHost } from './widget-host';
import { connectMcpApp, initializeMcpApp } from './mcp-app-bridge';
afterEach(() => {
  resetWidgetHost();
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
  expect(factory).toHaveBeenCalled();
  expect(host.connect).toHaveBeenCalledWith(undefined, { timeout: 10000 });
  expect(window.openai).toBe(bridge);
  expect(getWidgetHost()?.widgetState).toBe(bridge.widgetState);
  getWidgetHost()?.setWidgetState?.({ cart: ['phone'] });
  expect(bridge.setWidgetState).toHaveBeenCalledWith({ cart: ['phone'] });
  await getWidgetHost()?.callTool?.('get_product', { product_id: 'phone' });
  expect(bridge.callTool).not.toHaveBeenCalled();
  expect(host.callServerTool).toHaveBeenCalledWith({
    name: 'get_product',
    arguments: { product_id: 'phone' },
  });
});
it('delivers standard tool results, deferred arguments and host theme changes', async () => {
  await connectMcpApp();
  host.ontoolresult?.({ structuredContent: { products: [{ id: 'phone' }] } });
  expect(getWidgetHost()?.toolOutput).toEqual({ products: [{ id: 'phone' }] });
  host.ontoolinput?.({ arguments: { product_ids: ['phone'] } });
  expect(getWidgetHost()?.toolInput).toEqual({ product_ids: ['phone'] });
  host.onhostcontextchanged?.({ theme: 'dark' });
  expect(getWidgetHost()?.theme).toBe('dark');
  await getWidgetHost()?.callTool?.('update_ogabassey_guest_cart', {
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
  expect(getWidgetHost()?.toolOutput).toMatchObject({
    status: 'error',
    products: [],
  });
});
it('shows a safe fallback when the standard handshake fails', async () => {
  host.connect.mockRejectedValueOnce(new Error('private transport details'));
  await initializeMcpApp();
  expect(getWidgetHost()?.toolOutput).toMatchObject({
    status: 'error',
    products: [],
  });
  expect(JSON.stringify(getWidgetHost()?.toolOutput)).not.toContain(
    'private transport',
  );
});

it('uses the existing legacy bridge only when standard initialization fails', async () => {
  const bridge = { callTool: vi.fn(), widgetState: { cart: ['saved'] } };
  window.openai = bridge;
  host.connect.mockRejectedValueOnce(new Error('unsupported protocol'));
  await initializeMcpApp();
  expect(getWidgetHost()).toBe(bridge);
  expect(host.close).toHaveBeenCalled();
});
it('supports follow-up messages and local state without ChatGPT extensions', async () => {
  await connectMcpApp();
  getWidgetHost()?.setWidgetState?.({ cart: ['phone'] });
  expect(getWidgetHost()?.widgetState).toEqual({ cart: ['phone'] });
  getWidgetHost()?.sendFollowUpMessage?.({ prompt: 'Compare these phones' });
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
  expect(getWidgetHost()?.toolResponseMetadata).toEqual({ source: 'catalog' });
  const insets = { top: 1, right: 2, bottom: 3, left: 4 };
  host.onhostcontextchanged?.({ theme: 'dark', safeAreaInsets: insets });
  expect(getWidgetHost()?.safeArea).toEqual({ insets });
  expect(native).toEqual({ theme: 'light' });
});

it('does not advertise unsupported tool calls or fullscreen', async () => {
  host.getHostCapabilities.mockReturnValueOnce(
    {} as ReturnType<typeof host.getHostCapabilities>,
  );
  host.getHostContext.mockReturnValueOnce({
    theme: 'light',
    availableDisplayModes: ['inline'],
  });
  await connectMcpApp();
  expect(getWidgetHost()?.callTool).toBeUndefined();
  expect(getWidgetHost()?.requestDisplayMode).toBeUndefined();
});
it.each([
  'denied',
  'transport',
])('surfaces %s link failures without an unhandled rejection', async (failure) => {
  host.openLink.mockImplementationOnce(() =>
    failure === 'denied'
      ? Promise.resolve({ isError: true })
      : Promise.reject(new Error('private error')),
  );
  await connectMcpApp();
  await getWidgetHost()?.openExternal?.({ href: 'https://ogabassey.com/cart' });
  expect(getWidgetHost()?.hostError).toContain('Could not open');
});

it('retains a display-only legacy result when the standard handshake fails', async () => {
  const bridge = {
    toolOutput: { products: [{ id: 'phone' }] },
    openExternal: vi.fn(),
  };
  window.openai = bridge;
  host.connect.mockRejectedValueOnce(new Error('unsupported'));
  await initializeMcpApp();
  expect(getWidgetHost()).toBe(bridge);
  expect(getWidgetHost()?.toolOutput).toBe(bridge.toolOutput);
});
it('retains results delivered during a failed handshake', async () => {
  host.connect.mockImplementationOnce(async () => {
    host.ontoolresult?.({ structuredContent: { products: [{ id: 'phone' }] } });
    throw new Error('disconnect');
  });
  await initializeMcpApp();
  expect(getWidgetHost()?.toolOutput).toEqual({ products: [{ id: 'phone' }] });
});
it('does not expose unsupported link or message methods', async () => {
  host.getHostCapabilities.mockReturnValueOnce(
    {} as ReturnType<typeof host.getHostCapabilities>,
  );
  await connectMcpApp();
  expect(getWidgetHost()?.openExternal).toBeUndefined();
  expect(getWidgetHost()?.sendFollowUpMessage).toBeUndefined();
});
it.each([
  'denied',
  'transport',
])('surfaces %s follow-up failures safely', async (failure) => {
  host.sendMessage.mockImplementationOnce(() =>
    failure === 'denied'
      ? Promise.resolve({ isError: true })
      : Promise.reject(new Error('private details')),
  );
  await connectMcpApp();
  await getWidgetHost()?.sendFollowUpMessage?.({ prompt: 'Negotiate' });
  expect(getWidgetHost()?.hostError).toContain('Could not send');
  expect(getWidgetHost()?.hostError).not.toContain('private');
});
it('handles rejected display-mode and sizing calls without unhandled rejections', async () => {
  host.requestDisplayMode.mockRejectedValueOnce(new Error('private details'));
  host.sendSizeChanged.mockRejectedValueOnce(new Error('private details'));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await connectMcpApp();
  await getWidgetHost()?.requestDisplayMode?.({ mode: 'fullscreen' });
  await getWidgetHost()?.notifyIntrinsicHeight?.(300);
  expect(getWidgetHost()?.hostError).toContain('Could not expand');
  expect(warning).toHaveBeenCalledWith(
    'Ogabassey widget size notification failed.',
  );
  warning.mockRestore();
});

it('shows a connection error for navigation-only extensions with no delivered result', async () => {
  window.openai = { openExternal: vi.fn(), setWidgetState: vi.fn() };
  host.connect.mockRejectedValueOnce(new Error('unsupported'));
  await initializeMcpApp();
  expect(getWidgetHost()?.toolOutput).toMatchObject({
    status: 'error',
    products: [],
  });
});

it('retains native actions when the standard host omits their capabilities', async () => {
  const native = {
    callTool: vi.fn().mockResolvedValue({}),
    openExternal: vi.fn(),
    sendFollowUpMessage: vi.fn(),
  };
  window.openai = native;
  host.getHostCapabilities.mockReturnValueOnce(
    {} as ReturnType<typeof host.getHostCapabilities>,
  );
  await connectMcpApp();
  await getWidgetHost()?.callTool?.('get_product', { product_id: 'phone' });
  await getWidgetHost()?.openExternal?.({ href: 'https://ogabassey.com' });
  await getWidgetHost()?.sendFollowUpMessage?.({ prompt: 'Negotiate' });
  expect(native.callTool).toHaveBeenCalledWith('get_product', {
    product_id: 'phone',
  });
  expect(native.openExternal).toHaveBeenCalledWith({
    href: 'https://ogabassey.com',
  });
  expect(native.sendFollowUpMessage).toHaveBeenCalledWith({
    prompt: 'Negotiate',
  });
  expect(host.callServerTool).not.toHaveBeenCalled();
  expect(host.openLink).not.toHaveBeenCalled();
  expect(host.sendMessage).not.toHaveBeenCalled();
});
