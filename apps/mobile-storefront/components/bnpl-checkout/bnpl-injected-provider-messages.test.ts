import { runInNewContext } from 'node:vm';
import { expect, jest, test } from '@jest/globals';

test('skips routine provider diagnostics in production and preserves checkout signals', () => {
  const reactNativeGlobal = globalThis as typeof globalThis & {
    __DEV__: boolean;
  };
  const debugFlag = jest.replaceProperty(reactNativeGlobal, '__DEV__', false);
  let script = '';
  try {
    jest.isolateModules(() => {
      const helpers = jest.requireActual<
        typeof import('./bnpl-checkout.helpers')
      >('./bnpl-checkout.helpers');
      script = helpers.BNPL_INJECTED_JAVASCRIPT;
    });
  } finally {
    debugFlag.restore();
  }

  type Message = { origin: string; data: Record<string, unknown> };
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

  const provider = 'https://checkout.creditdirect.ng';
  for (let count = 0; count < 1000; count += 1) {
    emit({ origin: provider, data: { type: 'resize' } });
  }
  expect(postMessage).not.toHaveBeenCalled();

  emit({
    origin: provider,
    data: { type: 'notification', data: { name: 'checkout.widget.closed' } },
  });
  emit({ origin, data: { type: 'checkoutStatus', status: 'pending' } });

  expect(
    postMessage.mock.calls.map(([message]) => JSON.parse(message))
  ).toEqual([
    expect.objectContaining({
      type: 'bnpl_log',
      summary: expect.objectContaining({ name: 'checkout.widget.closed' }),
    }),
    { type: 'checkoutStatus', status: 'pending' },
  ]);
});
