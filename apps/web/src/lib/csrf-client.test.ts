import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCsrfHeaders,
  CSRF_HEADER_NAME,
  getClientCsrfToken,
} from './csrf-client';

describe('csrf-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads csrf-token from document.cookie', () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('csrf-token=token-123');
    expect(getClientCsrfToken()).toBe('token-123');
  });

  it('returns null and warns when building headers without a CSRF cookie', () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const headers = buildCsrfHeaders({ 'Content-Type': 'application/json' });

    expect(headers).toEqual({ 'Content-Type': 'application/json' });
    expect(headers[CSRF_HEADER_NAME]).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('merges extra headers and attaches x-csrf-token when cookie exists', () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('csrf-token=abc=def');
    const headers = buildCsrfHeaders([['X-Custom', '1']]);

    expect(headers).toEqual({
      'X-Custom': '1',
      [CSRF_HEADER_NAME]: 'abc=def',
    });
  });
});
