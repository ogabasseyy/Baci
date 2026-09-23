import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
  process.env.GIGL_QUOTE_TIMEOUT_MS = '100';
});

import { GiglApiClient } from './gigl.auth';
import { getGiglQuotes } from './gigl.quotes';
import { GiglStationsService } from './gigl.stations';
import {
  jsonResponse,
  loginResponse,
  priceResponse,
  quoteRequest,
  stationsResponse,
} from './gigl.test-helpers';

function buildHarness() {
  const log = vi.fn();
  const safeFetch = (
    url: string,
    options?: RequestInit & { timeout?: number }
  ) => fetch(url, options);
  const apiClient = new GiglApiClient({ safeFetch, log });
  const stationsService = new GiglStationsService(apiClient);

  return {
    getQuotes: () =>
      getGiglQuotes(
        apiClient,
        stationsService,
        {
          safeFetch,
          log,
          generateQuoteId: () => crypto.randomUUID(),
          getQuoteExpiry: () => new Date('2026-09-03T12:00:00.000Z'),
        },
        quoteRequest
      ),
    log,
  };
}

function abortablePendingResponse(signal: AbortSignal | null | undefined) {
  return new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    });
  });
}

describe('GIGL quote cancellation telemetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not report cancelled pickup prefetches as timeouts after home quote success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith('/login')) return jsonResponse(loginResponse);
        if (url.endsWith('/localstations/get')) {
          return jsonResponse(stationsResponse);
        }

        const payload = JSON.parse(String(init?.body ?? '{}')) as {
          PickUpOptions?: number;
        };
        return payload.PickUpOptions === 0
          ? jsonResponse(priceResponse)
          : abortablePendingResponse(init?.signal);
      })
    );
    const harness = buildHarness();

    const quotes = await harness.getQuotes();

    expect(quotes).toHaveLength(2);
    expect(harness.log).not.toHaveBeenCalledWith(
      'warn',
      'GIGL quote option timed out',
      expect.anything()
    );
  });

  it('still reports options cancelled by a genuine parent quote deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith('/login')) return jsonResponse(loginResponse);
        if (url.endsWith('/localstations/get')) {
          return jsonResponse(stationsResponse);
        }
        return abortablePendingResponse(init?.signal);
      })
    );
    const harness = buildHarness();

    await expect(harness.getQuotes()).resolves.toEqual([]);
    expect(harness.log).toHaveBeenCalledWith(
      'warn',
      'GIGL quote option timed out',
      expect.objectContaining({ timeoutMs: 100 })
    );
  });
});
