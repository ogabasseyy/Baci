import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryCardTransferFixture as fixture } from './primary-wallet-card-transfer.test-fixture';
import { createPrimaryCardTransferLookup } from './primary-wallet-card-transfer-lookup';
import { runPrimaryCardTransfer } from './primary-wallet-card-transfer-worker';
import {
  jsonResponse,
  type LiveTransferStatus,
  liveJustSubmittedNotFound,
  liveTransactionStatus,
} from './transaction-status-live.test-support';

const FIVE_MINUTES = 5 * 60 * 1000;
const binding = {
  reference: fixture.command.reference,
  amountKobo: fixture.command.amountKobo,
  sourceWalletId: fixture.command.sourceWalletId,
  destinationWalletId: fixture.command.destinationWalletId,
  customerId: 'owner-treasury-customer',
};

// In-memory twin of piggyvest_primary_card.transfer_outbox: claim_transfer
// reclaims stale dispatching rows and revisits 'unknown' rows after five
// minutes; record_transfer needs the live claim token.
function outbox() {
  let clock = 0;
  let state: 'ready' | 'dispatching' | 'submitted' | 'unknown' = 'ready';
  let updatedAt = 0;
  let token = 0;
  const ports = {
    claim: vi.fn(async () => {
      const aged = clock - updatedAt >= FIVE_MINUTES;
      const revisit = (state === 'unknown' || state === 'dispatching') && aged;
      if (state !== 'ready' && !revisit) return { outcome: 'existing' };
      state = 'dispatching';
      updatedAt = clock;
      token += 1;
      return {
        outcome: revisit ? 'reclaimed' : 'claimed',
        token: `00000000-0000-4000-8000-${String(token).padStart(12, '0')}`,
        command: fixture.command,
      };
    }),
    record: vi.fn(async (_id: string, _token: string, submitted: boolean) => {
      if (state !== 'dispatching') return false;
      state = submitted ? 'submitted' : 'unknown';
      updatedAt = clock;
      return true;
    }),
  };
  return {
    ports,
    state: () => state,
    advance: () => {
      clock += FIVE_MINUTES;
    },
  };
}

function liveProvider(
  answers: ReadonlyArray<'not_found' | LiveTransferStatus>
) {
  let served = 0;
  const fetchImplementation = vi.fn(async () => {
    const answer = answers[Math.min(served, answers.length - 1)];
    served += 1;
    return answer === 'not_found'
      ? jsonResponse(liveJustSubmittedNotFound, 404)
      : jsonResponse(liveTransactionStatus(binding, answer));
  });
  const lookup = createPrimaryCardTransferLookup({
    configuration: fixture.configuration,
    fetchImplementation,
    now: () => fixture.now,
  });
  // The provider accepted the only POST, but its response was lost.
  const submitTransfer = vi
    .fn()
    .mockRejectedValueOnce(new Error('response lost after send'))
    .mockResolvedValue(undefined);
  return {
    submitTransfer,
    lookupTransfer: (command: unknown) => lookup(command, fixture.context),
  };
}

function run(
  store: ReturnType<typeof outbox>,
  provider: ReturnType<typeof liveProvider>
) {
  return runPrimaryCardTransfer({
    operationId: fixture.context.operationId,
    ...store.ports,
    submitTransfer: provider.submitTransfer,
    lookupTransfer: provider.lookupTransfer,
  });
}

let alerts: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const reviewAlert = (reason: string) =>
  `[PiggyVest Webhook][ALERT] PIGGYVEST_TRANSFER_NEEDS_REVIEW {"reason":"${reason}","operationId":"${fixture.context.operationId}"}`;

describe('card transfer outbox against the live TSQ indexing lag', () => {
  it('records the transfer once it is indexed after 404 then pending, with exactly one POST', async () => {
    const store = outbox();
    const provider = liveProvider(['not_found', 'pending', 'successful']);

    expect(await run(store, provider)).toBe('unknown');
    expect(store.state()).toBe('unknown');
    store.advance();
    expect(await run(store, provider)).toBe('unknown');
    store.advance();
    expect(await run(store, provider)).toBe('submitted');

    expect(store.state()).toBe('submitted');
    expect(provider.submitTransfer).toHaveBeenCalledOnce();
    expect(alerts).not.toHaveBeenCalled();
  });

  it('holds a reference still not found past the revisit window for review, never resubmitting it', async () => {
    const store = outbox();
    const provider = liveProvider(['not_found']);

    for (let revisit = 0; revisit < 4; revisit += 1) {
      expect(await run(store, provider)).toBe('unknown');
      expect(store.state()).toBe('unknown');
      store.advance();
    }

    expect(provider.submitTransfer).toHaveBeenCalledOnce();
    // The first 404 follows the lost POST inside the indexing window; every
    // revisit past the window raises the transfer for operator review.
    expect(alerts).toHaveBeenCalledTimes(3);
    expect(alerts).toHaveBeenLastCalledWith(
      reviewAlert('card_reference_not_found')
    );
  });

  it('never resubmits the same reference after the provider reports it failed', async () => {
    const store = outbox();
    const provider = liveProvider(['failed']);

    expect(await run(store, provider)).toBe('unknown');
    store.advance();
    expect(await run(store, provider)).toBe('unknown');

    expect(store.state()).toBe('unknown');
    expect(provider.submitTransfer).toHaveBeenCalledOnce();
    expect(alerts).toHaveBeenCalledOnce();
    expect(alerts).toHaveBeenCalledWith(reviewAlert('card_reference_failed'));
  });
});
