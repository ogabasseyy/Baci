import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfInitializer } from './csrf-initializer';

function clearCsrfCookies() {
  document.cookie = 'csrf-token=; Path=/; Max-Age=0';
  document.cookie = '__Host-csrf-token=; Path=/; Max-Age=0';
}

describe('CsrfInitializer', () => {
  afterEach(() => {
    clearCsrfCookies();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips GET /api/csrf on mount when a CSRF cookie is already readable', () => {
    document.cookie = 'csrf-token=existing-token; Path=/';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<CsrfInitializer />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches /api/csrf on mount when no CSRF cookie is present', async () => {
    clearCsrfCookies();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CsrfInitializer />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/csrf'));
  });
});
