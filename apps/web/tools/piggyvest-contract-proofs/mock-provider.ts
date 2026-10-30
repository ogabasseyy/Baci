import { type MockOptions, type MockReply, MockSandbox } from './mock-sandbox';

/**
 * fetch-compatible router over MockSandbox. It sits UNDER the guarded fetch,
 * so dry-run exercises the same guards, typed client and Zod schemas as a
 * live run. It authenticates like the real API (Bearer test key required).
 */

export const MOCK_API_KEY = 'test_key_dryrunmock0000';

export interface MockProvider {
  fetch: typeof fetch;
  sandbox: MockSandbox;
  /** Every request that reached the mock, for assertions. */
  calls: { method: string; pathname: string; search: string }[];
}

function jsonBody(init: RequestInit | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(String(init?.body ?? '{}'));
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const pathParam = (pattern: RegExp, pathname: string): string | null => {
  const match = pattern.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
};

function route(
  sandbox: MockSandbox,
  method: string,
  url: URL,
  init?: RequestInit
): MockReply {
  const p = url.pathname;
  const q = url.searchParams;
  if (method === 'POST') {
    if (p === '/api/v1/customers')
      return sandbox.createCustomer(
        jsonBody(init),
        q.get('returnIfExist') === 'true'
      );
    if (p === '/api/v1/wallet/sub-account')
      return sandbox.createWallet(jsonBody(init));
    if (p === '/api/v1/transfer/wallet')
      return sandbox.ledger.transfer('wallet', jsonBody(init));
    if (p === '/api/v1/transfer/bank')
      return sandbox.ledger.transfer('bank', jsonBody(init));
    if (p === '/api/v1/transfer/test/funding')
      return sandbox.ledger.fund(jsonBody(init));
  } else if (method === 'GET') {
    if (p === '/api/v1/customers') return sandbox.listCustomers(q);
    if (p === '/api/v1/wallet/api/wallet-type') return sandbox.listWallets(q);
    if (p === '/api/v1/transaction') return sandbox.ledger.listTransactions(q);
    if (p === '/api/v1/transaction/verify') return sandbox.ledger.verify(q);
    const accrued = pathParam(
      /^\/api\/v1\/wallet\/interests\/accrued\/([^/]+)$/,
      p
    );
    if (accrued) return sandbox.ledger.accruedInterest(accrued, q);
    const accounts = pathParam(/^\/api\/v1\/wallet\/([^/]+)\/accounts$/, p);
    if (accounts) return sandbox.walletAccounts(accounts);
    const wallet = pathParam(/^\/api\/v1\/wallet\/([^/]+)$/, p);
    if (wallet) return sandbox.retrieveWallet(wallet);
    const transaction = pathParam(/^\/api\/v1\/transaction\/([^/]+)$/, p);
    if (transaction) return sandbox.ledger.transaction(transaction);
  }
  return { status: 404, body: { status: false, message: 'Route not found' } };
}

export function createMockProvider(
  options: Partial<MockOptions> = {}
): MockProvider {
  const sandbox = new MockSandbox(options);
  const pendingFailures = [...sandbox.options.failNetworkOnce];
  const calls: MockProvider['calls'] = [];
  const mockFetch = (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, pathname: url.pathname, search: url.search });
    const failure = pendingFailures.findIndex((needle) =>
      url.pathname.includes(needle)
    );
    if (failure >= 0) {
      pendingFailures.splice(failure, 1);
      return Promise.reject(new TypeError('fetch failed'));
    }
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Bearer ${MOCK_API_KEY}`) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ status: false, message: 'Unauthorized' }),
          { status: 401 }
        )
      );
    }
    if (
      method === 'GET' &&
      sandbox.options.serverErrorPaths.some((needle) =>
        `${url.pathname}${url.search}`.includes(needle)
      )
    ) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ status: false, message: 'Service unavailable' }),
          { status: 503 }
        )
      );
    }
    const reply = route(sandbox, method, url, init);
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), { status: reply.status })
    );
  };
  return { fetch: mockFetch as typeof fetch, sandbox, calls };
}
