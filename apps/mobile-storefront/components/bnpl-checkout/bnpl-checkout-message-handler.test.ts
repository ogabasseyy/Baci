import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  createBNPLWebViewMessageHandler,
  logBNPLCheckoutDebug,
} from './bnpl-checkout-message-handler';

describe('createBNPLWebViewMessageHandler', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDev = (globalThis as typeof globalThis & { __DEV__?: boolean })
    .__DEV__;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ =
      originalDev;
    jest.restoreAllMocks();
  });

  it('treats terminal WebView messages as diagnostics only', () => {
    process.env.NODE_ENV = 'development';
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;
    const info = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const handler = createBNPLWebViewMessageHandler();

    handler({
      nativeEvent: {
        data: JSON.stringify({
          reference: 'forged-reference',
          type: 'bnpl_success',
        }),
      },
    });

    expect(info).toHaveBeenCalledWith(
      '[BNPLCheckout] webview message',
      expect.objectContaining({
        reference: 'forged-reference',
        type: 'bnpl_success',
      })
    );
  });

  it('delegates explicit BNPL close messages to the controller', () => {
    const onCloseMessage = jest.fn();
    const handler = createBNPLWebViewMessageHandler({ onCloseMessage });

    handler({
      nativeEvent: {
        data: JSON.stringify({
          type: 'bnpl_close',
        }),
      },
    });

    expect(onCloseMessage).toHaveBeenCalledTimes(1);
  });

  it('delegates Credit Direct provider close messages to the controller', () => {
    const onCloseMessage = jest.fn();
    const handler = createBNPLWebViewMessageHandler({ onCloseMessage });

    handler({
      nativeEvent: {
        data: JSON.stringify({
          message: 'Provider postMessage received',
          source: 'https://checkout.creditdirect.ng',
          summary: {
            payloadType: 'object',
            type: 'checkout.widget.closed',
          },
          type: 'bnpl_log',
        }),
      },
    });

    expect(onCloseMessage).toHaveBeenCalledTimes(1);
  });

  it('delegates provider-opened messages to the controller', () => {
    const onProviderOpenedMessage = jest.fn();
    const handler = createBNPLWebViewMessageHandler({
      onProviderOpenedMessage,
    });

    handler({
      nativeEvent: {
        data: JSON.stringify({
          type: 'bnpl_provider_opened',
          gateway: 'credpal',
          orderId: 'order-1',
        }),
      },
    });

    expect(onProviderOpenedMessage).toHaveBeenCalledTimes(1);
    expect(onProviderOpenedMessage).toHaveBeenCalledWith({
      gateway: 'credpal',
      orderId: 'order-1',
    });
  });

  it('forwards the routed reference on provider lifecycle messages', () => {
    const onProviderOpenedMessage = jest.fn();
    const onProviderErrorMessage = jest.fn();
    const handler = createBNPLWebViewMessageHandler({
      onProviderOpenedMessage,
      onProviderErrorMessage,
    });

    handler({
      nativeEvent: {
        data: JSON.stringify({
          type: 'bnpl_provider_opened',
          gateway: 'klump',
          orderId: 'order-1',
          reference: 'BAC-1',
        }),
      },
    });
    handler({
      nativeEvent: {
        data: JSON.stringify({
          type: 'bnpl_provider_error',
          gateway: 'klump',
          orderId: 'order-1',
          message: 'declined',
          reference: 'BAC-1',
        }),
      },
    });

    expect(onProviderOpenedMessage).toHaveBeenCalledWith({
      gateway: 'klump',
      orderId: 'order-1',
      reference: 'BAC-1',
    });
    expect(onProviderErrorMessage).toHaveBeenCalledWith({
      gateway: 'klump',
      orderId: 'order-1',
      message: 'declined',
      reference: 'BAC-1',
    });
  });

  it('logs navigation messages and delegates URL handling to the controller', () => {
    process.env.NODE_ENV = 'development';
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;
    const info = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const onNavigationMessage = jest.fn();
    const handler = createBNPLWebViewMessageHandler({ onNavigationMessage });

    handler({
      nativeEvent: {
        data: JSON.stringify({
          type: 'navigation',
          url: 'https://ogabassey.usebaci.com/order-success?reference=BAC-123',
        }),
      },
    });

    expect(info).toHaveBeenCalledWith(
      '[BNPLCheckout] diagnostic navigation message',
      {
        url: 'https://ogabassey.usebaci.com/order-success?reference=BAC-123',
      }
    );
    expect(onNavigationMessage).toHaveBeenCalledWith(
      'https://ogabassey.usebaci.com/order-success?reference=BAC-123'
    );
  });

  it('logs and ignores primitive JSON messages', () => {
    process.env.NODE_ENV = 'development';
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;
    const info = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const handler = createBNPLWebViewMessageHandler();

    handler({
      nativeEvent: {
        data: JSON.stringify(true),
      },
    });

    expect(info).toHaveBeenCalledWith(
      '[BNPLCheckout] ignored primitive webview message',
      { data: 'true' }
    );
  });

  it('logs and ignores non-JSON messages', () => {
    process.env.NODE_ENV = 'development';
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;
    const info = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const handler = createBNPLWebViewMessageHandler();

    handler({
      nativeEvent: {
        data: 'not-a-json',
      },
    });

    expect(info).toHaveBeenCalledWith(
      '[BNPLCheckout] ignored non-json webview message',
      { data: 'not-a-json' }
    );
  });
});

describe('logBNPLCheckoutDebug', () => {
  it('stays silent in test mode', () => {
    const info = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);

    logBNPLCheckoutDebug('event', { ok: true });

    expect(info).not.toHaveBeenCalled();
  });
});
