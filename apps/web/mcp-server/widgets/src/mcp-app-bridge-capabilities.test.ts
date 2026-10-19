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

import { connectMcpApp } from './mcp-app-bridge';
import { widgetHost } from './widget-host';

afterEach(() => {
  widgetHost.reset();
  delete window.openai;
  vi.clearAllMocks();
});

it('retains native actions when the standard host omits their capabilities', async () => {
  const native = {
    callTool: vi.fn().mockResolvedValue({}),
    openExternal: vi.fn(),
    sendFollowUpMessage: vi.fn(),
  };
  window.openai = native;
  host.getHostCapabilities.mockReturnValueOnce(
    {} as ReturnType<typeof host.getHostCapabilities>
  );
  await connectMcpApp();
  await widgetHost.get()?.callTool?.('get_product', { product_id: 'phone' });
  await widgetHost.get()?.openExternal?.({ href: 'https://ogabassey.com' });
  await widgetHost.get()?.sendFollowUpMessage?.({ prompt: 'Negotiate' });
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

it('falls back to the native display-mode bridge when the standard context omits fullscreen', async () => {
  const native = {
    requestDisplayMode: vi.fn().mockResolvedValue({ mode: 'fullscreen' }),
  };
  window.openai = native;
  host.getHostContext.mockReturnValueOnce({
    theme: 'light',
    availableDisplayModes: ['inline'],
  });
  await connectMcpApp();
  await widgetHost.get()?.requestDisplayMode?.({ mode: 'fullscreen' });
  expect(native.requestDisplayMode).toHaveBeenCalledWith({
    mode: 'fullscreen',
  });
  expect(host.requestDisplayMode).not.toHaveBeenCalled();
});

it('surfaces native link denials as host errors instead of unhandled rejections', async () => {
  const native = {
    openExternal: vi.fn().mockRejectedValueOnce(new Error('denied')),
  };
  window.openai = native;
  host.getHostCapabilities.mockReturnValueOnce(
    {} as ReturnType<typeof host.getHostCapabilities>
  );
  await connectMcpApp();
  await widgetHost.get()?.openExternal?.({ href: 'https://ogabassey.com' });
  expect(native.openExternal).toHaveBeenCalledWith({
    href: 'https://ogabassey.com',
  });
  expect(widgetHost.get()?.hostError).toContain('Could not open');
});

it('resolves native fallbacks through the live bridge after replacement', async () => {
  const first = { callTool: vi.fn().mockResolvedValue({}) };
  window.openai = first;
  host.getHostCapabilities.mockReturnValueOnce(
    {} as ReturnType<typeof host.getHostCapabilities>
  );
  await connectMcpApp();
  const second = { callTool: vi.fn().mockResolvedValue({}) };
  window.openai = second;
  await widgetHost.get()?.callTool?.('get_product', { product_id: 'phone' });
  expect(second.callTool).toHaveBeenCalledWith('get_product', {
    product_id: 'phone',
  });
  expect(first.callTool).not.toHaveBeenCalled();
});

it('leaves late-added native methods visible instead of shadowed', async () => {
  window.openai = {};
  host.getHostCapabilities.mockReturnValueOnce(
    {} as ReturnType<typeof host.getHostCapabilities>
  );
  await connectMcpApp();
  expect(widgetHost.get()?.openExternal).toBeUndefined();
  const openExternal = vi.fn();
  window.openai.openExternal = openExternal;
  await widgetHost.get()?.openExternal?.({ href: 'https://ogabassey.com' });
  expect(openExternal).toHaveBeenCalledWith({ href: 'https://ogabassey.com' });
});
