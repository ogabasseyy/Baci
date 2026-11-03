import { runInNewContext } from 'node:vm';
import { jest } from '@jest/globals';
import {
  PAYMENT_PAGE_INTERACTIVE_MESSAGE,
  PAYMENT_PAGE_INTERACTIVE_SCRIPT,
} from './payment-page-interactive-bridge';

describe('payment page interactive bridge', () => {
  it('reports the top-level document once after it becomes interactive', () => {
    let onReady: (() => void) | undefined;
    const postMessage = jest.fn();
    const window = {
      top: null as unknown,
      ReactNativeWebView: { postMessage },
    };
    window.top = window;
    const document = {
      readyState: 'loading',
      addEventListener: (_name: string, callback: () => void) => {
        onReady = callback;
      },
    };
    runInNewContext(PAYMENT_PAGE_INTERACTIVE_SCRIPT, { document, window });
    expect(postMessage).not.toHaveBeenCalled();
    onReady?.();
    runInNewContext(PAYMENT_PAGE_INTERACTIVE_SCRIPT, { document, window });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: PAYMENT_PAGE_INTERACTIVE_MESSAGE })
    );
  });

  it('does not report an iframe as an interactive checkout', () => {
    const postMessage = jest.fn();
    const window = { top: {}, ReactNativeWebView: { postMessage } };
    runInNewContext(PAYMENT_PAGE_INTERACTIVE_SCRIPT, {
      document: { readyState: 'interactive' },
      window,
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('can report later if the native bridge was unavailable at document readiness', () => {
    let onReady: (() => void) | undefined;
    const postMessage = jest.fn();
    const window: {
      top: unknown;
      ReactNativeWebView?: { postMessage: typeof postMessage };
    } = { top: null };
    window.top = window;
    const document = {
      readyState: 'loading',
      addEventListener: (_name: string, callback: () => void) => {
        onReady = callback;
      },
    };
    runInNewContext(PAYMENT_PAGE_INTERACTIVE_SCRIPT, { document, window });
    onReady?.();
    window.ReactNativeWebView = { postMessage };
    document.readyState = 'complete';
    runInNewContext(PAYMENT_PAGE_INTERACTIVE_SCRIPT, { document, window });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });
});
