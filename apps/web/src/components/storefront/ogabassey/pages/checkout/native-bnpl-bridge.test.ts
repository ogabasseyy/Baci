import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bridgeOpenedAttemptError,
  notifyNativeBnplClose,
  notifyNativeBnplProviderError,
  notifyNativeBnplProviderOpened,
} from './native-bnpl-bridge';

describe('native bnpl bridge', () => {
  afterEach(() => {
    delete window.ReactNativeWebView;
    vi.unstubAllGlobals();
  });

  it('posts provider-opened signals when the shell bridge exists', () => {
    const postMessage = vi.fn();
    window.ReactNativeWebView = { postMessage };

    const delivered = notifyNativeBnplProviderOpened(
      'klump',
      'order-1',
      'ref-1'
    );

    expect(delivered).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        gateway: 'klump',
        orderId: 'order-1',
        reference: 'ref-1',
        type: 'bnpl_provider_opened',
      })
    );
  });

  it('returns false outside a native shell', () => {
    expect(notifyNativeBnplProviderOpened('credpal', 'order-1')).toBe(false);
    expect(
      notifyNativeBnplProviderError('credpal', 'order-1', 'sdk failed')
    ).toBe(false);
    expect(notifyNativeBnplClose('klump')).toBe(false);
  });

  it('returns false when postMessage throws', () => {
    window.ReactNativeWebView = {
      postMessage: () => {
        throw new Error('bridge down');
      },
    };

    expect(notifyNativeBnplClose('credit_direct')).toBe(false);
  });

  it('sends gateway-specific close messages', () => {
    const postMessage = vi.fn();
    window.ReactNativeWebView = { postMessage };

    notifyNativeBnplClose('credit_direct');

    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        gateway: 'credit_direct',
        message: 'Credit Direct checkout closed',
        type: 'bnpl_close',
      })
    );
  });

  it('bridges errors only for attempts that opened', () => {
    const postMessage = vi.fn();
    window.ReactNativeWebView = { postMessage };
    const providerOpenedLaunchKeyRef = { current: 'launch-1' as string | null };

    const bridged = bridgeOpenedAttemptError({
      providerOpenedLaunchKeyRef,
      launchKey: 'launch-1',
      gateway: 'klump',
      orderId: 'order-1',
      message: 'sdk failed',
    });
    const skipped = bridgeOpenedAttemptError({
      providerOpenedLaunchKeyRef,
      launchKey: 'launch-2',
      gateway: 'klump',
      orderId: 'order-1',
      message: 'sdk failed',
    });

    expect(bridged).toBe(true);
    expect(skipped).toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });
});
