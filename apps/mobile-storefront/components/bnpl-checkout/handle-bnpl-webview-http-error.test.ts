import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { BNPLWebViewHttpErrorEvent } from './BNPLCheckoutWebView';
import { handleBNPLWebViewHttpError } from './handle-bnpl-webview-http-error';

const mockLogDebug = jest.fn();
jest.mock('./bnpl-checkout-message-handler', () => ({
  logBNPLCheckoutDebug: (...args: unknown[]) => mockLogDebug(...args),
}));

function httpErrorEvent(
  nativeEvent: Record<string, unknown>
): BNPLWebViewHttpErrorEvent {
  return { nativeEvent } as unknown as BNPLWebViewHttpErrorEvent;
}

describe('handleBNPLWebViewHttpError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs the http error context without throwing', () => {
    const event = httpErrorEvent({
      description: 'Not Found',
      statusCode: 404,
      url: 'https://pay.example/missing',
    });

    expect(() => handleBNPLWebViewHttpError(event)).not.toThrow();
    expect(mockLogDebug).toHaveBeenCalledWith(
      'http error',
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('reports a main-document failure to the caller for transition', () => {
    const onMainDocumentError = jest.fn();
    handleBNPLWebViewHttpError(
      httpErrorEvent({
        description: 'Internal Server Error',
        statusCode: 500,
        url: 'https://pay.example/checkout/start',
      }),
      {
        documentUrl: 'https://pay.example/checkout/start',
        onMainDocumentError,
      }
    );

    expect(mockLogDebug).toHaveBeenCalledWith(
      'http error',
      expect.objectContaining({ statusCode: 500 })
    );
    expect(onMainDocumentError).toHaveBeenCalledWith('Internal Server Error');
  });

  it('only logs subresource failures without failing the checkout', () => {
    const onMainDocumentError = jest.fn();
    handleBNPLWebViewHttpError(
      httpErrorEvent({
        description: 'Not Found',
        statusCode: 404,
        url: 'https://pay.example/assets/banner.png',
      }),
      {
        documentUrl: 'https://pay.example/checkout/start',
        onMainDocumentError,
      }
    );

    expect(mockLogDebug).toHaveBeenCalledWith(
      'http error',
      expect.objectContaining({ statusCode: 404 })
    );
    expect(onMainDocumentError).not.toHaveBeenCalled();
  });
});
