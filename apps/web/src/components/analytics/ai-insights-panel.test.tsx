import { render, screen, waitFor } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIInsightsPanel } from './ai-insights-panel';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

describe('AIInsightsPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests insights for the selected merchant', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ insights: [] }), { status: 200 })
      );

    render(
      <AIInsightsPanel activeCategory="overview" merchantId="merchant-1" />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/analytics/insights',
        expect.objectContaining({
          headers: { 'x-baci-merchant-id': 'merchant-1' },
        })
      );
    });
  });

  it('clears the previous merchant insights while the next request is loading', async () => {
    let requestCount = 0;
    let resolveSecondRequest: ((response: Response) => void) | undefined;
    const secondRequest = new Promise<Response>((resolve) => {
      resolveSecondRequest = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(
          JSON.stringify({
            insights: [
              {
                description: 'Merchant one detail',
                title: 'Merchant one insight',
                type: 'positive',
                priority: 'high',
              },
            ],
          }),
          { status: 200 }
        );
      }
      return secondRequest;
    });

    const { rerender } = render(
      <AIInsightsPanel activeCategory="overview" merchantId="merchant-1" />
    );
    await waitFor(() => {
      expect(screen.getByText('Merchant one insight')).toBeInTheDocument();
    });

    rerender(
      <AIInsightsPanel activeCategory="overview" merchantId="merchant-2" />
    );

    await waitFor(() => {
      expect(screen.getByText('Analyzing your data...')).toBeInTheDocument();
      expect(
        screen.queryByText('Merchant one insight')
      ).not.toBeInTheDocument();
    });

    resolveSecondRequest?.(
      new Response(JSON.stringify({ insights: [] }), { status: 200 })
    );
  });

  it('keeps the current merchant loading when the previous request aborts', async () => {
    let firstRequestAborted = false;
    let requestCount = 0;
    let resolveSecondRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_input, init) => {
        requestCount += 1;
        if (requestCount === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              firstRequestAborted = true;
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          });
        }

        return new Promise<Response>((resolve) => {
          resolveSecondRequest = resolve;
        });
      });

    const { container, rerender } = render(
      <AIInsightsPanel activeCategory="overview" merchantId="merchant-1" />
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    rerender(
      <AIInsightsPanel activeCategory="overview" merchantId="merchant-2" />
    );

    await waitFor(() => {
      expect(firstRequestAborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();

    resolveSecondRequest?.(
      new Response(JSON.stringify({ insights: [] }), { status: 200 })
    );
    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });
});
