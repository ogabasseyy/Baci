import { describe, expect, it } from 'vitest';
import {
  getResponseErrorMessage,
  isConnectivityError,
  isDnsResolutionError,
  NetworkError,
} from './api-errors';

describe('api errors', () => {
  it('preserves NetworkError metadata', () => {
    const error = new NetworkError('Timed out', {
      data: { code: 'timeout' },
      isTimeout: true,
      statusCode: 504,
    });

    expect(error.name).toBe('NetworkError');
    expect(error.isTimeout).toBe(true);
    expect(error.statusCode).toBe(504);
    expect(error.data).toEqual({ code: 'timeout' });
  });

  it('extracts response error messages by priority', () => {
    expect(getResponseErrorMessage('Plain error', 400)).toBe('Plain error');
    expect(getResponseErrorMessage({ message: 'Message field' }, 400)).toBe(
      'Message field'
    );
    expect(getResponseErrorMessage({ error: 'Error field' }, 400)).toBe(
      'Error field'
    );
    expect(getResponseErrorMessage({}, 500)).toBe(
      'Request failed with status 500'
    );
  });

  describe('isConnectivityError', () => {
    it('detects the iOS "Network request failed" TypeError', () => {
      expect(isConnectivityError(new TypeError('Network request failed'))).toBe(
        true
      );
    });

    it('detects Android raw ConnectException messages', () => {
      expect(
        isConnectivityError(
          new Error(
            'fetch failed: java.net.ConnectException: Failed to connect to usebaci.com/216.150.1.65:443'
          )
        )
      ).toBe(true);
    });

    it('detects connection failures reported only via the error cause', () => {
      // Outer message alone does not match; the connectivity signal is in cause.
      const error = new Error('request error', {
        cause: new Error('ECONNREFUSED 127.0.0.1:443'),
      });

      expect(isConnectivityError(error)).toBe(true);
    });

    it('detects returned Supabase error objects that are not Error instances', () => {
      expect(
        isConnectivityError({
          message:
            'fetch failed: A server with the specified hostname could not be found.',
        })
      ).toBe(true);
    });

    it('ignores connectivity text inherited through prototype properties', () => {
      const inheritedCause = Object.create({
        cause: new Error('getaddrinfo ENOTFOUND'),
      });
      const inheritedMessage = Object.create({
        message: 'Network request failed',
      });

      expect(isConnectivityError(inheritedCause)).toBe(false);
      expect(isDnsResolutionError(inheritedCause)).toBe(false);
      expect(isConnectivityError(inheritedMessage)).toBe(false);
    });

    it('does not treat server NetworkErrors as connectivity failures', () => {
      const serverError = new NetworkError(
        'Custom domains require Baci Starter or higher',
        { statusCode: 402 }
      );

      expect(isConnectivityError(serverError)).toBe(false);
    });

    it('does not treat unrelated errors as connectivity failures', () => {
      expect(isConnectivityError(new Error('Something else broke'))).toBe(
        false
      );
      expect(isConnectivityError('nope')).toBe(false);
      expect(isConnectivityError(null)).toBe(false);
    });
  });

  describe('isDnsResolutionError', () => {
    it('detects the exact iOS hostname-resolution failure from production', () => {
      expect(
        isDnsResolutionError({
          message:
            'fetch failed: A server with the specified hostname could not be found.',
        })
      ).toBe(true);
    });

    it('detects Android and Node DNS-resolution codes', () => {
      expect(
        isDnsResolutionError(
          new Error('Unable to resolve host api.example.com')
        )
      ).toBe(true);
      expect(isDnsResolutionError(new Error('getaddrinfo ENOTFOUND'))).toBe(
        true
      );
    });

    it('does not classify ambiguous transport failures as DNS failures', () => {
      expect(isDnsResolutionError(new Error('Network request failed'))).toBe(
        false
      );
      expect(isDnsResolutionError(new Error('ECONNRESET'))).toBe(false);
      expect(isDnsResolutionError(new Error('Request timed out'))).toBe(false);
    });
  });
});
