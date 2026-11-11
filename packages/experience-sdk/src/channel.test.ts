import { expect, it, vi } from 'vitest';
import { connectExperience } from './channel';

it('accepts only the parent from the canonical or one exact HTTPS preview origin, then pins the first port', () => {
  const accepted: unknown[] = [];
  const ignored: unknown[] = [];
  const makePort = (sent: unknown[]) => ({
    start() {},
    close() {},
    postMessage(value: unknown) {
      sent.push(value);
    },
    onmessage: null,
  });
  const send = (
    origin: string,
    source: Window | null,
    port: ReturnType<typeof makePort>
  ) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        origin,
        ports: [port as unknown as MessagePort],
        data: {
          type: 'baci-experience-connect',
          nonce: 'synthetic',
          instanceId: 'instance',
          buildDigest: 'a'.repeat(64),
        },
      })
    );
  const bridge = connectExperience('https://merchant.test', {
    previewOrigin: 'https://builder.baci.test',
  });
  send('https://evil.test', window, makePort(ignored));
  send('https://builder.baci.test', null, makePort(ignored));
  expect(ignored).toHaveLength(0);
  send('https://builder.baci.test', window, makePort(accepted));
  expect(accepted).toHaveLength(1);
  send('https://merchant.test', window, makePort(ignored));
  expect(ignored).toHaveLength(0);
  bridge.destroy();
  for (const previewOrigin of [
    'http://builder.test',
    'https://builder.test/path',
    'https://user:secret@builder.test',
  ])
    expect(() =>
      connectExperience('https://merchant.test', { previewOrigin })
    ).toThrow('INVALID_PREVIEW_ORIGIN');
});

it('serializes rapid navigation intents and sends the next with the acknowledged host epoch', async () => {
  const sent: Record<string, unknown>[] = [];
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    start() {},
    close() {},
    postMessage(data: Record<string, unknown>) {
      sent.push(data);
    },
  };
  const bridge = connectExperience('http://trusted.local');
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin: 'http://trusted.local',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n',
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
      },
      ports: [port as unknown as MessagePort],
    })
  );
  expect(sent.find((message) => message.type === 'ready')).not.toHaveProperty(
    'readiness'
  );
  port.onmessage?.({
    data: {
      type: 'bootstrap',
      bootstrap: {
        route: { epoch: 1 },
        catalog: { products: [], revision: '1' },
        capabilities: ['navigation'],
      },
    },
  });
  await bridge.ready;
  sent.length = 0;
  const b = bridge.commerce.navigation.go('/b');
  const c = bridge.commerce.navigation.go('/c');
  await Promise.resolve();
  expect(sent.filter((r) => r.method === 'navigation.go')).toHaveLength(1);
  const first = sent.find((r) => r.method === 'navigation.go');
  if (!first) throw new Error('Navigation request missing');
  // A newer streamed bootstrap can arrive before an older navigation result.
  port.onmessage?.({
    data: {
      type: 'bootstrap',
      bootstrap: {
        route: { epoch: 3 },
        catalog: { products: [], revision: '3' },
        capabilities: ['navigation'],
      },
    },
  });
  port.onmessage?.({
    data: { type: 'route', route: { epoch: 2, canonicalPath: '/b' } },
  });
  port.onmessage?.({
    data: {
      type: 'result',
      requestId: first.requestId,
      result: { status: 'ok', value: { epoch: 2 } },
    },
  });
  await b;
  await Promise.resolve();
  const second = sent.filter((r) => r.method === 'navigation.go')[1];
  expect(second.routeEpoch).toBe(3);
  port.onmessage?.({
    data: {
      type: 'result',
      requestId: second.requestId,
      result: { status: 'ok', value: { epoch: 3 } },
    },
  });
  await c;
  bridge.destroy();
});

it('advertises opt-in render-commit readiness and acknowledges the current bootstrap epoch', async () => {
  const sent: Record<string, unknown>[] = [];
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    start() {},
    close() {},
    postMessage(data: Record<string, unknown>) {
      sent.push(data);
    },
  };
  const bridge = connectExperience('http://trusted.local', {
    readiness: 'react-commit/v1',
  });
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin: 'http://trusted.local',
      data: {
        type: 'baci-experience-connect',
        nonce: 'bound-nonce',
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
      },
      ports: [port as unknown as MessagePort],
    })
  );
  expect(sent[0]).toMatchObject({
    type: 'ready',
    nonce: 'bound-nonce',
    readiness: 'react-commit/v1',
  });

  port.onmessage?.({
    data: {
      type: 'bootstrap',
      bootstrap: {
        route: { epoch: 4 },
        catalog: { products: [], revision: '4' },
        capabilities: [],
      },
    },
  });
  await bridge.ready;
  expect(bridge.acknowledgeRenderCommit(4)).toBe(true);
  expect(sent.at(-1)).toEqual({
    type: 'render-committed',
    nonce: 'bound-nonce',
    epoch: 4,
  });
  expect(bridge.acknowledgeRenderCommit(3)).toBe(false);
  bridge.destroy();
});

it('reports only the fixed render failure code for an opted-in runtime', () => {
  const sent: Record<string, unknown>[] = [];
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    start() {},
    close() {},
    postMessage(data: Record<string, unknown>) {
      sent.push(data);
    },
  };
  const bridge = connectExperience('http://trusted.local', {
    readiness: 'react-commit/v1',
  });
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin: 'http://trusted.local',
      data: {
        type: 'baci-experience-connect',
        nonce: 'bound-nonce',
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
      },
      ports: [port as unknown as MessagePort],
    })
  );

  bridge.failRenderCommit();

  expect(sent.at(-1)).toEqual({
    type: 'render-failed',
    nonce: 'bound-nonce',
    code: 'HYDRATION_FAILED',
  });
  bridge.destroy();
});

it('latches render failure raised before the host port connects', () => {
  const sent: Record<string, unknown>[] = [];
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    start() {},
    close() {},
    postMessage(data: Record<string, unknown>) {
      sent.push(data);
    },
  };
  const bridge = connectExperience('http://trusted.local', {
    readiness: 'react-commit/v1',
  });
  bridge.failRenderCommit();
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin: 'http://trusted.local',
      data: {
        type: 'baci-experience-connect',
        nonce: 'bound-nonce',
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
      },
      ports: [port as unknown as MessagePort],
    })
  );

  expect(sent.map((message) => message.type)).toEqual([
    'ready',
    'render-failed',
  ]);
  expect(sent.at(-1)).toMatchObject({ code: 'HYDRATION_FAILED' });
  bridge.destroy();
});
it('classifies an unanswered cart write as indeterminate using the original request identity', async () => {
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  const sent: Record<string, unknown>[] = [];
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    start() {},
    close() {},
    postMessage(data: Record<string, unknown>) {
      sent.push(data);
    },
  };
  const bridge = connectExperience('http://trusted.local');
  try {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: 'http://trusted.local',
        data: {
          type: 'baci-experience-connect',
          nonce: 'n',
          instanceId: 'i',
          buildDigest: 'a'.repeat(64),
        },
        ports: [port as unknown as MessagePort],
      })
    );
    const result = bridge.commerce.cart.add({
      productId: 'synthetic',
      quantity: 1,
    });
    const request = sent.find((v) => v.method === 'cart.add');
    await vi.advanceTimersByTimeAsync(10001);
    expect(await result).toEqual({
      status: 'indeterminate',
      operationId: request?.requestId,
    });
  } finally {
    bridge.destroy();
    vi.useRealTimers();
  }
});
it('delivers fresh catalog bootstrap updates without replacing the message port', async () => {
  const sent: Record<string, unknown>[] = [];
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    start() {},
    close() {},
    postMessage(data: Record<string, unknown>) {
      sent.push(data);
    },
  };
  const bridge = connectExperience('http://trusted.local');
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin: 'http://trusted.local',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n',
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
      },
      ports: [port as unknown as MessagePort],
    })
  );
  let revision = '';
  bridge.onBootstrap((data) => {
    revision = data.catalog.revision;
  });
  port.onmessage?.({
    data: {
      type: 'bootstrap',
      bootstrap: {
        route: { epoch: 2 },
        catalog: { products: [], revision: 'new' },
        capabilities: [],
      },
    },
  });
  expect(revision).toBe('new');
  expect(sent.filter((v) => v.type === 'ready')).toHaveLength(1);
  bridge.destroy();
});
it('keeps a dispatched cart write indeterminate when its port is retired', async () => {
  const sent: Record<string, unknown>[] = [];
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    start() {},
    close() {},
    postMessage(data: Record<string, unknown>) {
      sent.push(data);
    },
  };
  const bridge = connectExperience('http://trusted.local');
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin: 'http://trusted.local',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n',
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
      },
      ports: [port as unknown as MessagePort],
    })
  );
  const result = bridge.commerce.cart.add({
    productId: 'synthetic',
    quantity: 1,
  });
  const request = sent.find((v) => v.method === 'cart.add');
  bridge.destroy();
  expect(await result).toEqual({
    status: 'indeterminate',
    operationId: request?.requestId,
  });
});

it('exposes reconciliation after mutation timeout and retains the original ID on reconciliation timeout', async () => {
  vi.useFakeTimers();
  const sent: Record<string, unknown>[] = [];
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    start() {},
    close() {},
    postMessage(data: Record<string, unknown>) {
      sent.push(data);
    },
  };
  const bridge = connectExperience('https://shop.test');
  try {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: 'https://shop.test',
        ports: [port as unknown as MessagePort],
        data: {
          type: 'baci-experience-connect',
          instanceId: 'i',
          buildDigest: 'a'.repeat(64),
          nonce: 'n',
        },
      })
    );
    const add = bridge.commerce.cart.add({ productId: 'p', quantity: 1 });
    const original = sent.find((m) => m.method === 'cart.add')?.requestId;
    expect(typeof original).toBe('string');
    await vi.advanceTimersByTimeAsync(10000);
    expect(await add).toEqual({
      status: 'indeterminate',
      operationId: original,
    });
    const pending = bridge.commerce.cart.reconcile(String(original));
    expect(sent.find((m) => m.method === 'cart.reconcile')?.args).toEqual({
      operationId: original,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toEqual({
      status: 'indeterminate',
      operationId: original,
    });
    const retry = bridge.commerce.cart.reconcile(String(original));
    const reconciliation = sent
      .filter((m) => m.method === 'cart.reconcile')
      .at(-1);
    port.onmessage?.({
      data: {
        type: 'result',
        requestId: reconciliation?.requestId,
        result: {
          status: 'ok',
          value: { lines: [], version: 1, currency: 'NGN', total: 0 },
        },
      },
    });
    expect(await retry).toMatchObject({ status: 'ok' });
    expect(sent.filter((m) => m.method === 'cart.add')).toHaveLength(1);
  } finally {
    bridge.destroy();
    vi.useRealTimers();
  }
});
