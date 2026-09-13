import 'server-only';

import type {
  RedvaultRefundProvider,
  RedvaultRefundReconciliationProvider,
} from './redvault-refund-orchestrator';
import { createTestRedvaultPaystackRefundProvider } from './redvault-refund-paystack-provider';
import {
  type RedvaultRefundRpcClient,
  RedvaultRefundStore,
} from './redvault-refund-store';

const REFUND_RPC_NAMES = new Set([
  'claim_next_uba_redvault_refund',
  'claim_next_uba_redvault_refund_reconciliation',
  'finish_uba_redvault_refund',
  'reconcile_uba_redvault_refund',
  'record_uba_redvault_refund_provider_submission',
  'reserve_uba_redvault_refund',
]);

function parseLocalTestDatabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('REDVAULT refund recovery requires a local test database');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('REDVAULT refund recovery requires a local test database');
  }
  return url;
}

function isRestrictedTestJwt(value: string): boolean {
  const parts = value.split('.');
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^[A-Za-z0-9_-]{1,2048}$/.test(part))
  ) {
    return false;
  }
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    ) as { aud?: unknown; role?: unknown };
    return payload.aud === 'local' && payload.role === 'redvault_refund_test';
  } catch {
    return false;
  }
}

function isSafeRpcData(value: unknown): boolean {
  return value === null || (typeof value === 'object' && value !== null);
}

function createLocalTestRefundRpcClient({
  databaseUrl,
  fetcher,
  restrictedTestJwt,
}: {
  databaseUrl: string;
  fetcher: typeof fetch;
  restrictedTestJwt: string;
}): RedvaultRefundRpcClient {
  const baseUrl = parseLocalTestDatabaseUrl(databaseUrl);
  if (!isRestrictedTestJwt(restrictedTestJwt)) {
    throw new Error('REDVAULT refund recovery requires a restricted test JWT');
  }

  return {
    async rpc(functionName, args) {
      if (!REFUND_RPC_NAMES.has(functionName)) {
        return { data: null, error: { message: 'REDVAULT refund RPC denied' } };
      }
      let body: string;
      try {
        body = JSON.stringify(args);
      } catch {
        return {
          data: null,
          error: { message: 'REDVAULT refund RPC request invalid' },
        };
      }
      try {
        const response = await fetcher(
          new URL(`/rest/v1/rpc/${functionName}`, baseUrl),
          {
            body,
            cache: 'no-store',
            headers: {
              apikey: restrictedTestJwt,
              Authorization: `Bearer ${restrictedTestJwt}`,
              'Content-Type': 'application/json',
            },
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(15_000),
          }
        );
        if (!response.ok) {
          return {
            data: null,
            error: { message: 'REDVAULT refund RPC failed' },
          };
        }
        const data = await response.json();
        if (!isSafeRpcData(data)) {
          return {
            data: null,
            error: { message: 'REDVAULT refund RPC response invalid' },
          };
        }
        return { data, error: null };
      } catch {
        return { data: null, error: { message: 'REDVAULT refund RPC failed' } };
      }
    },
  };
}

export function createRedvaultRefundRecoveryTestTransport({
  databaseUrl,
  fetcher = fetch,
  providerKey,
  restrictedTestJwt,
}: {
  databaseUrl: string;
  fetcher?: typeof fetch;
  providerKey: string;
  restrictedTestJwt: string;
}): {
  provider: RedvaultRefundProvider & RedvaultRefundReconciliationProvider;
  providerEnvironment: 'test';
  store: RedvaultRefundStore;
} {
  const rpcClient = createLocalTestRefundRpcClient({
    databaseUrl,
    fetcher,
    restrictedTestJwt,
  });
  return {
    provider: createTestRedvaultPaystackRefundProvider({
      fetcher,
      providerKey,
    }),
    providerEnvironment: 'test',
    store: new RedvaultRefundStore(rpcClient),
  };
}
