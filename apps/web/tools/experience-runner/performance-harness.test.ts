import { runInNewContext } from 'node:vm';
import { afterEach, expect, it } from 'vitest';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import type { PerformanceWorkerInput } from '../../src/schemas/experience-performance-worker';
import { performanceWorkerInput } from '../../src/schemas/experience-performance-worker';
import { startPerformanceHarness } from './performance-harness';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
function input(): PerformanceWorkerInput {
  const javascript = 'document.body.dataset.synthetic="true";';
  return {
    mode: 'candidate-performance/v1',
    width: 390,
    bundle: {
      hostOrigin: 'http://127.0.0.1:44100',
      javascript,
      css: '',
      digest: digestBytes(`${javascript}\0`),
      imports: [],
    },
    bootstrap: {
      route: {
        routeId: 'home',
        epoch: 0,
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'public',
      },
      catalog: { products: [], revision: 'public' },
      capabilities: ['catalog.read'],
    },
    assets: [],
  };
}
it('supports an exact HTTPS parent with real TLS on a separate execution site', async () => {
  const value = input();
  value.bundle.hostOrigin = 'https://merchant.synthetic.test';
  const harness = await startPerformanceHarness(value);
  closers.push(harness.close);
  expect(harness.origin).toBe(value.bundle.hostOrigin);
  expect(harness.transport).toBe('https-loopback-tls');
  expect(harness.chromiumOptions.proxy?.server).toMatch(
    /^http:\/\/127\.0\.0\.1:\d+$/
  );
  expect(
    harness.chromiumOptions.args?.some((arg) =>
      arg.startsWith('--ignore-certificate-errors-spki-list=')
    )
  ).toBe(true);
  expect(harness.chromiumOptions.args).not.toContain(
    '--ignore-certificate-errors'
  );
});

async function connectHarness() {
  const value = input();
  const harness = await startPerformanceHarness(value);
  closers.push(harness.close);
  const script = await (await fetch(`${harness.origin}/host.js`)).text();
  const channels: Array<{ port1: TestPort; port2: TestPort }> = [];
  class TestPort {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    messages: unknown[] = [];
    closed = false;
    postMessage(message: unknown) {
      this.messages.push(message);
    }
    start() {}
    close() {
      this.closed = true;
    }
    receive(data: unknown) {
      this.onmessage?.({ data });
    }
  }
  class TestChannel {
    port1 = new TestPort();
    port2 = new TestPort();
    constructor() {
      channels.push(this);
    }
  }
  let load: (() => void) | undefined;
  let connectMessage: Record<string, unknown> | undefined;
  const frame = {
    addEventListener(_event: string, listener: () => void) {
      load = listener;
    },
    contentWindow: {
      postMessage(message: Record<string, unknown>) {
        connectMessage = message;
      },
    },
  };
  const document = {
    querySelector: () => frame,
    documentElement: { dataset: {} as Record<string, string> },
  };
  runInNewContext(script, { document, MessageChannel: TestChannel });
  load?.();
  const port = channels[0]?.port1;
  if (!port || !connectMessage) throw new Error('HARNESS_BRIDGE_NOT_CONNECTED');
  return {
    bootstrap: value.bootstrap,
    dataset: document.documentElement.dataset,
    nonce: connectMessage.nonce as string,
    port,
  };
}

it('waits for the exact route render commit before marking an opted-in bridge ready', async () => {
  const bridge = await connectHarness();
  bridge.port.receive({
    type: 'ready',
    nonce: bridge.nonce,
    readiness: 'react-commit/v1',
  });

  expect(bridge.port.messages).toEqual([
    { type: 'bootstrap', bootstrap: expect.objectContaining(bridge.bootstrap) },
  ]);
  expect(bridge.dataset.baciPerformanceBridgeReady).toBeUndefined();

  bridge.port.receive({
    type: 'render-committed',
    nonce: bridge.nonce,
    epoch: bridge.bootstrap.route.epoch - 1,
  });
  expect(bridge.dataset.baciPerformanceBridgeReady).toBeUndefined();
  expect(bridge.dataset.baciPerformanceBridgeFailed).toBeUndefined();

  bridge.port.receive({
    type: 'render-committed',
    nonce: bridge.nonce,
    epoch: bridge.bootstrap.route.epoch,
  });
  expect(bridge.dataset.baciPerformanceBridgeReady).toBe('true');
});

it.each([
  [
    'malformed acknowledgement',
    (nonce: string) => ({ type: 'render-committed', nonce, epoch: '0' }),
  ],
  [
    'forged acknowledgement',
    () => ({ type: 'render-committed', nonce: 'forged', epoch: 0 }),
  ],
  [
    'future acknowledgement',
    (nonce: string) => ({ type: 'render-committed', nonce, epoch: 1 }),
  ],
])('fails closed on a %s', async (_label, acknowledgement) => {
  const bridge = await connectHarness();
  bridge.port.receive({
    type: 'ready',
    nonce: bridge.nonce,
    readiness: 'react-commit/v1',
  });
  bridge.port.receive(acknowledgement(bridge.nonce));

  expect(bridge.dataset.baciPerformanceBridgeReady).toBeUndefined();
  expect(bridge.dataset.baciPerformanceBridgeFailed).toBe('true');
  expect(bridge.port.closed).toBe(true);
});

it('fails closed when an opted-in render reports failure', async () => {
  const bridge = await connectHarness();
  bridge.port.receive({
    type: 'ready',
    nonce: bridge.nonce,
    readiness: 'react-commit/v1',
  });
  bridge.port.receive({ type: 'render-failed', nonce: bridge.nonce });

  expect(bridge.dataset.baciPerformanceBridgeReady).toBeUndefined();
  expect(bridge.dataset.baciPerformanceBridgeFailed).toBe('true');
  expect(bridge.port.closed).toBe(true);
});

it('preserves immediate readiness for legacy bridges without readiness negotiation', async () => {
  const bridge = await connectHarness();
  bridge.port.receive({ type: 'ready', nonce: bridge.nonce });

  expect(bridge.port.messages).toHaveLength(1);
  expect(bridge.dataset.baciPerformanceBridgeReady).toBe('true');
  expect(bridge.dataset.baciPerformanceBridgeFailed).toBeUndefined();
});

it('fails closed on an unsupported readiness protocol', async () => {
  const bridge = await connectHarness();
  bridge.port.receive({
    type: 'ready',
    nonce: bridge.nonce,
    readiness: 'future/v2',
  });

  expect(bridge.port.messages).toHaveLength(0);
  expect(bridge.dataset.baciPerformanceBridgeReady).toBeUndefined();
  expect(bridge.dataset.baciPerformanceBridgeFailed).toBe('true');
  expect(bridge.port.closed).toBe(true);
});
it('serves only bounded loopback reference resources with effects disabled', async () => {
  const value = input();
  const harness = await startPerformanceHarness(value);
  closers.push(harness.close);
  const parent = await fetch(harness.origin);
  expect(parent.status).toBe(200);
  expect(parent.headers.get('content-security-policy')).toContain(
    "default-src 'none'"
  );
  expect(await parent.text()).toContain('sandbox="allow-scripts"');
  const bridge = await (await fetch(`${harness.origin}/host.js`)).text();
  expect(bridge).toContain('INSUFFICIENT_SCOPE');
  expect(bridge).not.toContain('/api/orders');
  expect((await fetch(harness.origin, { method: 'POST' })).status).toBe(405);
  const child = await fetch('http://127.0.0.1:4101/index.html');
  expect(child.headers.get('content-security-policy')).toContain(
    "connect-src 'none'"
  );
  expect(child.headers.get('access-control-allow-origin')).toBe('*');
  expect(
    (
      await fetch(
        `http://127.0.0.1:4101/resource/${value.bundle.digest}/app.js`
      )
    ).status
  ).toBe(200);
  expect(
    (await fetch('http://127.0.0.1:4101/resource/other/app.js')).status
  ).toBe(404);
});
it('rejects an asset digest mismatch before opening a server', async () => {
  const value = input();
  value.assets.push({
    assetId: 'device',
    digest: 'a'.repeat(64),
    mime: 'image/png',
    bytesBase64: 'eA==',
  });
  await expect(startPerformanceHarness(value)).rejects.toThrow('BUILD_FAILED');
});
it('rejects extra private/bootstrap fields rather than forwarding them to a browser', () => {
  const value = input();
  expect(
    performanceWorkerInput.safeParse({
      ...value,
      bootstrap: { ...value.bootstrap, authToken: 'private' },
    }).success
  ).toBe(false);
  expect(
    performanceWorkerInput.safeParse({ ...value, approved: true }).success
  ).toBe(false);
  expect(
    performanceWorkerInput.safeParse({ ...value, width: 393 }).success
  ).toBe(false);
});

it.each([
  '',
  'relative',
  '//other-host',
  `/${'x'.repeat(240)}`,
])('rejects a canonical route that cannot satisfy the worker result contract: %s', (canonicalPath) => {
  const value = input();
  value.bootstrap.route.canonicalPath = canonicalPath;
  expect(performanceWorkerInput.safeParse(value).success).toBe(false);
});
it('accepts the maximum supported canonical route length', () => {
  const value = input();
  value.bootstrap.route.canonicalPath = `/${'x'.repeat(239)}`;
  expect(performanceWorkerInput.safeParse(value).success).toBe(true);
});
