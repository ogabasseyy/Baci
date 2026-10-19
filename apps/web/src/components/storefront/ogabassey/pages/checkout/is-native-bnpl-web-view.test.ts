import { describe, expect, it, vi } from 'vitest';
import { isNativeBnplWebView } from './is-native-bnpl-web-view';

describe('isNativeBnplWebView', () => {
  it('returns false outside a native WebView', () => {
    expect(isNativeBnplWebView()).toBe(false);
  });

  it('returns true when the native bridge is present', () => {
    window.ReactNativeWebView = { postMessage: vi.fn() };
    try {
      expect(isNativeBnplWebView()).toBe(true);
    } finally {
      delete window.ReactNativeWebView;
    }
  });
});
