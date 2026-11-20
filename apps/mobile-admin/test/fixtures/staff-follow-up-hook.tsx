import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { useStaffOrderFollowUps } from '@/hooks/useStaffOrderFollowUps';

export const MERCHANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const VIEWER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export type QueryResult = { data: unknown; error: { code: string } | null };

export const orderId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function followUp(n: number, overrides: Record<string, unknown> = {}) {
  return {
    order_id: orderId(n),
    merchant_id: MERCHANT,
    assignee_id: VIEWER,
    assignee_name: 'Ada',
    stage: 'needs_follow_up',
    outcome: '',
    follow_up_on: null,
    revision: 1,
    updated_at: '2026-11-19T10:00:00+00:00',
    ...overrides,
  };
}

export function openRow(
  n: number,
  overrides: Record<string, unknown> = {},
  order: Record<string, unknown> = {}
) {
  return {
    ...followUp(n, overrides),
    order: {
      id: orderId(n),
      order_number: `ORD-${n}`,
      customer_id: null,
      customer_name: 'Ada Buyer',
      customer_email: 'ada@example.test',
      customer_phone: '+2348012345678',
      currency: 'NGN',
      total: '15000',
      payment_status: 'paid',
      payment_method: 'card',
      created_at: '2026-11-18T10:00:00+00:00',
      cancelled_at: null,
      ...order,
    },
  };
}

/** A PostgREST-style chain: every filter returns the chain, awaiting it yields the result. */
export function queryBuilder(result: QueryResult | Promise<QueryResult>) {
  const calls: [string, unknown[]][] = [];
  const methods = Object.fromEntries(
    ['select', 'eq', 'neq', 'not', 'order', 'limit', 'in'].map((name) => [
      name,
      vi.fn((...args: unknown[]) => {
        calls.push([name, args]);
        return builder;
      }),
    ])
  );
  const builder = Object.assign(Promise.resolve(result), methods);
  return { builder, calls };
}

export const ok = (data: unknown): QueryResult => ({ data, error: null });
export const failed = (): QueryResult => ({
  data: null,
  error: { code: 'XX000' },
});

export function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

export function render(
  orderIds: string[] = [],
  scope: { merchantId?: string; viewerId?: string } = {
    merchantId: MERCHANT,
    viewerId: VIEWER,
  }
) {
  return renderHook(
    () => useStaffOrderFollowUps(scope.merchantId, scope.viewerId, orderIds),
    { wrapper: createWrapper() }
  );
}
