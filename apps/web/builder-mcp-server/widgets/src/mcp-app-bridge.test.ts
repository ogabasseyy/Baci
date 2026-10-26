import { expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  getHostContext: () => ({
    theme: 'dark',
    displayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
  }),
  getHostCapabilities: () => ({ openLinks: true }),
  requestDisplayMode: vi.fn().mockResolvedValue({ mode: 'fullscreen' }),
  sendSizeChanged: vi.fn().mockResolvedValue(undefined),
  openLink: vi.fn().mockResolvedValue({}),
}));
const appConstructor = vi.hoisted(() => vi.fn());
vi.mock('@modelcontextprotocol/ext-apps/app-with-deps', () => ({
  App: class {
    constructor(...args: unknown[]) {
      appConstructor(...args);
      // biome-ignore lint/correctness/noConstructorReturn: Event-addressable SDK test double.
      return fake;
    }
  },
}));

import { connectPreviewApp, createPreviewHost } from './mcp-app-bridge';

it('negotiates standard inline/fullscreen, inherits theme, restricts links and clears on input/cancel/teardown', async () => {
  const host = createPreviewHost();
  const close = await connectPreviewApp(host);
  expect(appConstructor).toHaveBeenCalledWith(
    expect.anything(),
    { availableDisplayModes: ['inline', 'fullscreen'] },
    { autoResize: false }
  );
  expect(host.get()).toMatchObject({ theme: 'dark', ready: true });
  Reflect.get(fake, 'onhostcontextchanged')({ displayMode: 'fullscreen' });
  expect(host.get().theme).toBe('dark');
  await host.expand();
  expect(host.get().mode).toBe('fullscreen');
  await host.open();
  expect(fake.openLink).toHaveBeenCalledWith({
    url: 'https://usebaci.com/builder',
  });
  host.size(200);
  expect(fake.sendSizeChanged).toHaveBeenCalledWith({ height: 200 });
  await close();
  expect(host.get()).toMatchObject({ preview: null, ready: false });
});
it('turns initialization failure into an actionable alert without a stale snapshot', async () => {
  fake.connect.mockRejectedValueOnce(new Error('secret'));
  const host = createPreviewHost();
  await connectPreviewApp(host);
  expect(host.get()).toMatchObject({
    preview: null,
    ready: false,
    error: expect.stringContaining('Could not connect'),
  });
});
it('does not resurrect a torn-down preview when initialization finishes late', async () => {
  let finish: () => void = () => {
    throw new Error('missing handshake');
  };
  fake.connect.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const host = createPreviewHost();
  const pending = connectPreviewApp(host);
  await Reflect.get(fake, 'onteardown')();
  finish();
  const close = await pending;
  expect(host.get().ready).toBe(false);
  await close();
});
