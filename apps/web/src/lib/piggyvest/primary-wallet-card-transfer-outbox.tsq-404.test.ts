import { beforeEach, expect, it, vi } from 'vitest';
import { primaryCardTransferFixture as fixture } from './primary-wallet-card-transfer.test-fixture';
import { runPrimaryCardTransferOutbox } from './primary-wallet-card-transfer-outbox';
import {
  freshOutboxDatabaseState,
  outboxDatabaseQuery,
} from './primary-wallet-card-transfer-outbox.test-support';
import {
  jsonResponse,
  liveJustSubmittedNotFound,
} from './transaction-status-live.test-support';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  state: 'ready',
  failRecord: false,
  invalid: false,
  stuckSibling: false,
}));
vi.mock('pg', () => ({
  Client: class {
    connect = async () => undefined;
    query = mocks.query;
    end = async () => undefined;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(mocks, freshOutboxDatabaseState());
  mocks.query.mockImplementation(outboxDatabaseQuery(mocks));
});

const run = (fetchImplementation: typeof fetch) =>
  runPrimaryCardTransferOutbox({
    environment: fixture.environment,
    now: () => fixture.now,
    fetchImplementation,
    mode: 'once',
  });

it('holds a submit throw whose reference TSQ does not find for review and never posts it again', async () => {
  let posts = 0;
  const fetchImplementation = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      // The POST loses its response; TSQ then answers 404 because the
      // transfer is not indexed yet
      // (docs/piggyvest-contract-evidence/2026-10-31.md, P2).
      if (init?.method === 'GET')
        return jsonResponse(liveJustSubmittedNotFound, 404);
      posts += 1;
      throw new Error('response lost after send');
    }
  );
  expect(await run(fetchImplementation)).toMatchObject({
    status: 'reconciliation_required',
    selectedCount: 1,
    unknownCount: 1,
  });
  expect(mocks.state).toBe('unknown');
  expect(await run(fetchImplementation)).toMatchObject({
    status: 'reconciliation_required',
    selectedCount: 0,
  });
  expect(posts).toBe(1);
});
