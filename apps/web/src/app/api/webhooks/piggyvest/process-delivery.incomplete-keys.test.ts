import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  custody: vi.fn(),
  bank: vi.fn(),
  interest: vi.fn(),
  inflow: vi.fn(),
  quarantine: vi.fn(),
  record: vi.fn(),
  process: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-dispatch', () => ({
  dispatchPrimaryCardSignedCustodyIntake: (...args: unknown[]) =>
    mocks.custody(...args),
}));
vi.mock('@/lib/piggyvest/primary-interest-webhook-response', () => ({
  primaryInterestWebhookResponse: (...args: unknown[]) =>
    mocks.interest(...args),
}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-intake', () => ({
  dispatchPrimaryWalletBankInboxIntake: (...args: unknown[]) =>
    mocks.bank(...args),
}));
vi.mock('@/lib/piggyvest/primary-wallet-inflow-dispatch', () => ({
  dispatchPrimaryWalletInflow: (...args: unknown[]) => mocks.inflow(...args),
}));
vi.mock('./quarantine-and-ack', () => ({
  quarantineAndAck: (...args: unknown[]) => mocks.quarantine(...args),
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: (...args: unknown[]) => mocks.record(...args),
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) => mocks.process(...args),
}));

import { primaryCardCustodyInboxFixture } from '@/lib/piggyvest/primary-wallet-card-custody-inbox.test-fixture';
import { paidInterestFixture } from '@/lib/piggyvest/primary-wallet-paid-interest.test-support';
import type { PiggyvestWebhookKeyFamily } from '@/lib/piggyvest/webhook-secret-union';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  isAuthorizationQuarantine,
  isKeySetIncompleteRetry,
  processVerifiedDelivery,
} from './process-delivery';
import { inflow } from './route.capture.incomplete-keys.test-support';

/**
 * Under an incomplete key set a delivery of an event type a primary intake
 * family owns is "completed" only when THAT intake actually ran. Reaching
 * the legacy fallback (which can return a successful no-op, for example a
 * custody envelope whose reference is only in pvb_reference) is not
 * completion: the owning family's assignment may simply not be loaded, the
 * capture's recorded authority cannot be widened later, and a 200 would end
 * the provider's retries. With a complete key set nothing changes.
 */

const client = {} as unknown as PiggyvestIntakeServiceClient;
const createClient = () => client;

const CASES: {
  name: string;
  body: string;
  owner: PiggyvestWebhookKeyFamily;
  stranger: PiggyvestWebhookKeyFamily;
  intake: typeof mocks.custody;
}[] = [
  {
    name: 'custody (wallet-transfer.outflow.success)',
    body: primaryCardCustodyInboxFixture.rawBody.toString(),
    owner: 'custody',
    stranger: 'interest',
    intake: mocks.custody,
  },
  {
    name: 'bank (bank-transfer.inflow.success)',
    body: inflow,
    owner: 'bank',
    stranger: 'custody',
    intake: mocks.bank,
  },
  {
    name: 'interest (interest-payout.success)',
    body: JSON.stringify(paidInterestFixture.event),
    owner: 'interest',
    stranger: 'bank',
    intake: mocks.interest,
  },
];

function ownerAbsentVariants(
  stranger: PiggyvestWebhookKeyFamily
): [string, PiggyvestWebhookKeyFamily[]][] {
  return [
    ['legacy key present', ['legacy']],
    ['legacy key absent', [stranger]],
  ];
}

function run(
  body: string,
  families: PiggyvestWebhookKeyFamily[],
  incompleteKeySet: boolean
) {
  return processVerifiedDelivery(
    {
      rawBody: Buffer.from(body),
      signature: 'ab'.repeat(64),
      matchedSecret: 'matched-secret',
      families,
      incompleteKeySet,
    },
    { createClient, getPiggyvestConfig: () => null }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const owned = () =>
    Response.json({ received: true, ownedByPrimaryIntake: true });
  mocks.custody.mockResolvedValue({ outcome: 'accepted', response: owned() });
  mocks.bank.mockResolvedValue({ outcome: 'accepted', response: owned() });
  mocks.interest.mockResolvedValue(owned());
  mocks.inflow.mockResolvedValue('ignored');
  mocks.record.mockResolvedValue('new');
  mocks.process.mockResolvedValue('processed');
  mocks.quarantine.mockImplementation(async () =>
    Response.json({ received: true, quarantined: true })
  );
});

describe.each(CASES)('$name', ({ body, owner, stranger, intake }) => {
  describe.each(
    ownerAbsentVariants(stranger)
  )('owning family not loaded, %s', (_label, families) => {
    it('is retryable and never completed by the legacy fallback while the key set is incomplete', async () => {
      const response = await run(body, families, true);

      expect(response.status).toBe(503);
      expect(isKeySetIncompleteRetry(response)).toBe(true);
      expect(await response.json()).toEqual({
        error: 'Integration unavailable',
        code: 'PIGGYVEST_NOT_READY',
      });
      expect(intake).not.toHaveBeenCalled();
      expect(mocks.record).not.toHaveBeenCalled();
      expect(mocks.process).not.toHaveBeenCalled();
      expect(mocks.quarantine).not.toHaveBeenCalled();
    });

    it('keeps its existing outcome with a complete key set', async () => {
      const response = await run(body, families, false);

      expect(isKeySetIncompleteRetry(response)).toBe(false);
      expect(intake).not.toHaveBeenCalled();
      if (families.includes('legacy')) {
        // Legacy fallback proceeds (a legacy-signed delivery).
        expect(response.status).toBe(200);
        expect(mocks.process).toHaveBeenCalledTimes(1);
      } else {
        // Wrong family: a genuine authorization quarantine.
        expect(isAuthorizationQuarantine(response)).toBe(true);
        expect(mocks.process).not.toHaveBeenCalled();
      }
    });
  });

  describe.each([
    true,
    false,
  ])('owning family loaded (incomplete key set: %s)', (incompleteKeySet) => {
    it('runs the owning intake and returns its answer, not the fallback', async () => {
      const response = await run(body, ['legacy', owner], incompleteKeySet);

      expect(intake).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        received: true,
        ownedByPrimaryIntake: true,
      });
      expect(isKeySetIncompleteRetry(response)).toBe(false);
      expect(mocks.process).not.toHaveBeenCalled();
    });
  });
});

describe('bank inflow answered by the legacy inflow path', () => {
  it('is still retryable while incomplete: the bank inbox that owns the event did not run', async () => {
    mocks.inflow.mockResolvedValue('credited');

    const response = await run(inflow, ['legacy'], true);

    expect(response.status).toBe(503);
    expect(isKeySetIncompleteRetry(response)).toBe(true);
    expect(mocks.bank).not.toHaveBeenCalled();
  });

  it('completes as before with a complete key set', async () => {
    mocks.inflow.mockResolvedValue('credited');

    const response = await run(inflow, ['legacy'], false);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false });
  });
});

describe('event types no primary family owns', () => {
  it('still complete through legacy processing under an incomplete key set', async () => {
    const body = JSON.stringify({
      eventId: 'evt-restriction-1',
      eventType: 'restriction-created.success',
      eventCategory: 'restriction',
      customer_id: 'customer-1',
      eventData: {},
      pvb_wallet: 'wallet-1',
    });

    const response = await run(body, ['legacy'], true);

    expect(response.status).toBe(200);
    expect(isKeySetIncompleteRetry(response)).toBe(false);
    expect(mocks.process).toHaveBeenCalledTimes(1);
  });
});
