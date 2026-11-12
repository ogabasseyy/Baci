import { runInNewContext } from 'node:vm';
import { expect, jest, test } from '@jest/globals';

type Message = { origin: string; data: Record<string, unknown> };
type ReactNativeGlobal = typeof globalThis & { __DEV__?: boolean };

function loadInjectedScript(devMode: boolean | undefined) {
  const reactNativeGlobal = globalThis as ReactNativeGlobal;
  const hadDevFlag = Object.hasOwn(reactNativeGlobal, '__DEV__');
  const originalDevFlag = reactNativeGlobal.__DEV__;
  if (devMode === undefined) {
    delete reactNativeGlobal.__DEV__;
  } else {
    reactNativeGlobal.__DEV__ = devMode;
  }

  try {
    let script = '';
    jest.isolateModules(() => {
      const helpers = jest.requireActual<
        typeof import('./bnpl-checkout.helpers')
      >('./bnpl-checkout.helpers');
      script = helpers.BNPL_INJECTED_JAVASCRIPT;
    });
    return script;
  } finally {
    if (hadDevFlag) {
      reactNativeGlobal.__DEV__ = originalDevFlag;
    } else {
      delete reactNativeGlobal.__DEV__;
    }
  }
}

function runInjectedScript(script: string) {
  const listeners = new Map<string, (event: Message) => void>();
  const postMessage = jest.fn<(message: string) => void>();
  const origin = 'https://store.example';
  runInNewContext(script, {
    URL,
    console: { log: jest.fn() },
    history: { pushState: jest.fn(), replaceState: jest.fn() },
    window: {
      location: new URL(origin),
      ReactNativeWebView: { postMessage },
      addEventListener: (event: string, handler: (event: Message) => void) =>
        listeners.set(event, handler),
    },
  });
  const emit = listeners.get('message');
  if (!emit) throw new Error('WebView message listener was not installed');
  return { emit, origin, postMessage };
}

test('skips routine provider diagnostics in production and preserves checkout signals', () => {
  const { emit, origin, postMessage } = runInjectedScript(
    loadInjectedScript(false)
  );

  const provider = 'https://checkout.creditdirect.ng';
  for (let count = 0; count < 1000; count += 1) {
    emit({ origin: provider, data: { type: 'resize' } });
  }
  expect(postMessage).not.toHaveBeenCalled();

  emit({
    origin: provider,
    data: { type: 'notification', data: { name: 'checkout.widget.closed' } },
  });
  emit({
    origin: provider,
    data: { type: 'notification', message: 'checkout.widget.closed' },
  });
  emit({
    origin: provider,
    data: {
      type: 'notification',
      data: { message: 'checkout.widget.closed' },
    },
  });
  emit({ origin, data: { type: 'checkoutStatus', status: 'pending' } });

  expect(
    postMessage.mock.calls.map(([message]) => JSON.parse(message))
  ).toEqual([
    expect.objectContaining({
      type: 'bnpl_log',
      summary: expect.objectContaining({ name: 'checkout.widget.closed' }),
    }),
    expect.objectContaining({
      type: 'bnpl_log',
      summary: expect.objectContaining({ message: 'checkout.widget.closed' }),
    }),
    expect.objectContaining({
      type: 'bnpl_log',
      summary: expect.objectContaining({ message: 'checkout.widget.closed' }),
    }),
    { type: 'checkoutStatus', status: 'pending' },
  ]);
});

test('still forwards routine provider diagnostics in development', () => {
  const { emit, postMessage } = runInjectedScript(loadInjectedScript(true));

  emit({
    origin: 'https://checkout.creditdirect.ng',
    data: { type: 'resize' },
  });

  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(JSON.parse(postMessage.mock.calls[0]?.[0] ?? '')).toEqual(
    expect.objectContaining({
      type: 'bnpl_log',
      summary: expect.objectContaining({ type: 'resize' }),
    })
  );
});

test('loads safely in an environment without the React Native __DEV__ global', () => {
  expect(() => loadInjectedScript(undefined)).not.toThrow();
});
