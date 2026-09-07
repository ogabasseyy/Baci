import { vi } from 'vitest';
import type { getMerchantWalletAccount } from './merchant-wallet-payment-accounts';

type Row = Record<string, unknown>;

export function client(
  rows: Row[] = [],
  options: {
    assignmentExisting?: Row | null;
    assignmentExistingError?: Error | null;
    assignmentRequestError?: Error | null;
    assignmentRequestRows?: Row[];
    assignmentRequestSingle?: Row | null;
    insertError?: Error;
    rpcError?: Error;
  } = {}
) {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: null, error: options.rpcError ?? null });
  const accountChain: Record<string, unknown> = {};
  const requestChain: Record<string, unknown> = {};
  let maybeCalls = 0;
  let requestUpdateCalls = 0;
  const requestStatusFilters: unknown[] = [];
  let requestRowsForQuery = options.assignmentRequestRows ?? [];
  for (const chain of [accountChain, requestChain]) {
    chain.select = () => chain;
    chain.eq = () => chain;
  }
  accountChain.in = () => accountChain;
  requestChain.in = (_column: unknown, values: unknown) => {
    requestStatusFilters.push(values);
    const allowedStatuses = Array.isArray(values) ? values : [];
    requestRowsForQuery = (options.assignmentRequestRows ?? []).filter((row) =>
      allowedStatuses.includes(row.status)
    );
    return requestChain;
  };
  accountChain.maybeSingle = async () => ({
    data:
      options.insertError && ++maybeCalls > 1
        ? { id: 'pending' }
        : (options.assignmentExisting ?? rows[0] ?? null),
    error: options.assignmentExistingError ?? null,
  });
  requestChain.maybeSingle = async () => ({
    data: requestUpdateCalls
      ? { id: 'r', status: 'failed' }
      : (options.assignmentRequestSingle ??
        options.assignmentRequestRows?.[0] ??
        (options.insertError
          ? {
              id: 'pending',
              created_at: new Date().toISOString(),
              status: 'pending',
            }
          : null)),
    error: options.assignmentRequestError ?? null,
  });
  // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are thenable.
  requestChain.then = (resolve: (value: unknown) => unknown) =>
    resolve({
      data: requestRowsForQuery,
      error: options.assignmentRequestError ?? null,
    });
  requestChain.update = () => {
    requestUpdateCalls += 1;
    return requestChain;
  };
  requestChain.insert = () => requestChain;
  requestChain.single = async () => ({
    data: { id: 'req1', status: 'pending' },
    error: options.insertError ?? null,
  });
  return {
    from: (table: string) =>
      table === 'merchant_wallet_funding_account_requests'
        ? requestChain
        : accountChain,
    rpc,
    chain: accountChain,
    getRequestUpdateCalls: () => requestUpdateCalls,
    getRequestStatusFilters: () => requestStatusFilters,
  } as unknown as Parameters<typeof getMerchantWalletAccount>[0] & {
    getRequestStatusFilters: () => unknown[];
  };
}
