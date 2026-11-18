// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  createServer: vi.fn(),
  close: vi.fn(),
  launch: vi.fn(),
}));
vi.mock('node:http', () => ({ createServer: f.createServer }));
vi.mock('playwright-core', () => ({
  chromium: { launch: f.launch },
  firefox: { launch: f.launch },
  webkit: { launch: f.launch },
  selectors: { register: vi.fn() },
}));
vi.mock('../../tools/experience-runner/preview-gateway', () => ({
  startPreviewGateway: async () => ({
    close: f.close,
    origin: 'http://127.0.0.1:4101',
  }),
}));

import { runCheckpointB } from './checkpoint-b-worker';
import { fixtureCatalog } from './fixtures/qualification-fixtures';

beforeEach(() => {
  vi.clearAllMocks();
  f.close.mockResolvedValue(undefined);
});
const workerInput = (): Parameters<typeof runCheckpointB>[0] => ({
  engine: 'chromium' as const,
  width: 390,
  bundle: {
    javascript: 'export default null;',
    css: '',
    digest: 'a'.repeat(64),
  },
  manifest: {
    format: 'baci.experience/v2' as const,
    runtime: 'react-browser-sandbox/v1' as const,
    sdkVersion: 'commerce-bridge/v1' as const,
    entry: 'app.tsx',
    files: [{ path: 'app.tsx', content: 'export default null;' }],
    packages: [],
    routes: [{ path: '/', view: 'home' as const }],
    assets: [],
    capabilities: ['navigation'],
  },
  bootstrap: {
    catalog: fixtureCatalog,
    capabilities: ['navigation'],
    route: {
      epoch: 1,
      routeId: 'home',
      canonicalPath: '/',
      params: {},
      publicDataRevision: fixtureCatalog.revision,
    },
  },
});
it('rejects a failed host bind and closes the already-open private gateway', async () => {
  const error = Object.assign(Error('synthetic occupied port'), {
    code: 'EADDRINUSE',
  });
  const host = new EventEmitter();
  let protectedBeforeListen = false;
  f.createServer.mockReturnValue(
    Object.assign(host, {
      listen: () => {
        protectedBeforeListen = host.listenerCount('error') > 0;
        host.emit('error', error);
      },
    })
  );
  await expect(runCheckpointB(workerInput())).rejects.toBe(error);
  expect(protectedBeforeListen).toBe(true);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.launch).not.toHaveBeenCalled();
});

it('reports the bounded action phase when a post-ready browser action fails', async () => {
  const server = Object.assign(new EventEmitter(), {
    listen: (_port: number, _host: string, callback: () => void) => callback(),
    closeAllConnections: vi.fn(),
    close: (callback: () => void) => callback(),
  });
  f.createServer.mockReturnValue(server);

  const locator = {
    click: vi.fn(async () => {
      throw Error('synthetic cart click failure');
    }),
    waitFor: vi.fn(async () => {}),
    count: vi.fn(async () => 0),
    first: vi.fn(() => locator),
    nth: vi.fn(() => locator),
    filter: vi.fn(() => locator),
    getAttribute: vi.fn(async () => 'allow-scripts'),
  };
  const frame = {
    getByRole: vi.fn(() => locator),
    locator: vi.fn(() => locator),
  };
  const page = {
    setDefaultTimeout: vi.fn(),
    on: vi.fn(),
    goto: vi.fn(async () => {}),
    frameLocator: vi.fn(() => frame),
    locator: vi.fn(() => locator),
    getByRole: vi.fn(() => locator),
  };
  const browser = {
    newContext: async () => ({ newPage: async () => page }),
    close: vi.fn(async () => {}),
  };
  f.launch.mockResolvedValue(browser);
  const output = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);

  await expect(runCheckpointB(workerInput())).rejects.toThrow(
    'synthetic cart click failure'
  );

  const phases = output.mock.calls
    .map(([message]) => String(message))
    .filter((message) => message.startsWith('QUALIFICATION_PHASE '));
  expect(phases).toEqual([
    'QUALIFICATION_PHASE start\n',
    'QUALIFICATION_PHASE browser-launch\n',
    'QUALIFICATION_PHASE browser-launched\n',
    'QUALIFICATION_PHASE page-goto\n',
    'QUALIFICATION_PHASE page-loaded\n',
    'QUALIFICATION_PHASE frame-ready\n',
    'QUALIFICATION_PHASE cart-add\n',
    'QUALIFICATION_PHASE browser-close\n',
    'QUALIFICATION_PHASE browser-closed\n',
    'QUALIFICATION_PHASE host-closed\n',
    'QUALIFICATION_PHASE gateway-closed\n',
  ]);
  output.mockRestore();
  expect(browser.close).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
});
