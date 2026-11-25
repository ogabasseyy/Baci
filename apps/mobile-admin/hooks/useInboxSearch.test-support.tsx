import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

export const hit = (id: number, snippet: string | null = 'order') => ({
  conversation: {
    id,
    status: 'open' as const,
    unreadCount: 0,
    customerName: `Shopper ${id}`,
    lastActivityAt: null,
    lastMessage: null,
  },
  snippet,
});

export const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

/** Moves the fake clock forward and lets every resulting promise settle. */
export const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/**
 * Moves the clock, then lets the chain of renders, effects and requests settle:
 * each page of a multi-page search is its own render-then-effect step.
 */
export const settle = async (ms: number) => {
  await advance(ms);
  for (let i = 0; i < 10; i++) await advance(0);
};

export const DEBOUNCE = 350;

/** Fake clock, immediate React Query notifications and a known merchant. */
export function installSearchHarness(merchant: ReturnType<typeof vi.fn>): void {
  vi.useFakeTimers();
  // React Query hands results to React on a timer; run it at once instead so
  // the fake clock only has to drive the debounce.
  notifyManager.setScheduler((callback) => callback());
  vi.clearAllMocks();
  merchant.mockReturnValue({ merchant: { id: 'm1' } });
}

export function uninstallSearchHarness(): void {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.useRealTimers();
}
