import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { BNPLWebViewHttpErrorEvent } from './BNPLCheckoutWebView';
import { handleBNPLWebViewHttpError } from './handle-bnpl-webview-http-error';

const mockLogDebug = jest.fn();
jest.mock('./bnpl-checkout-message-handler', () => ({
  logBNPLCheckoutDebug: (...args: unknown[]) => mockLogDebug(...args),
}));

describe('handleBNPLWebViewHttpError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs the http error context without throwing', () => {
    const event = {
      nativeEvent: {
        description: 'Not Found',
        statusCode: 404,
        url: 'https://pay.example/missing',
      },
    } as unknown as BNPLWebViewHttpErrorEvent;

    expect(() => handleBNPLWebViewHttpError(event)).not.toThrow();
    expect(mockLogDebug).toHaveBeenCalledWith(
      'http error',
      expect.objectContaining({ statusCode: 404 })
    );
  });
});
