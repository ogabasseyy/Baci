import { beforeEach, describe, expect, it, vi } from 'vitest';

type Reader = () => unknown;
const readers = vi.hoisted(() => ({
  bankInbox: vi.fn<Reader>(),
  inflow: vi.fn<Reader>(),
  interestInbox: vi.fn<Reader>(),
  interestDirect: vi.fn<Reader>(),
  custody: vi.fn<Reader>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxRuntime: readers.bankInbox,
}));
vi.mock('@/lib/piggyvest/primary-wallet-inflow-runtime', () => ({
  readPrimaryWalletInflowRuntime: readers.inflow,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxRuntime: readers.interestInbox,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-runtime', () => ({
  readPrimaryWalletPaidInterestRuntime: readers.interestDirect,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeRuntime: readers.custody,
}));

import {
  collectPrimaryIntakeEvidence,
  isPrimaryLegacyBankInflowUnavailable,
  primaryIntakeReason,
} from './webhook-capture-primary-intake-readiness';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const ENV = { NODE_ENV: 'test' } as const;
const configured = { configured: true };
const off = () => null;
const broken = () => {
  throw new Error('Primary intake configuration unavailable');
};

function allIntakesReady() {
  readers.bankInbox.mockReturnValue(configured);
  readers.inflow.mockReturnValue(null);
  readers.interestInbox.mockReturnValue(configured);
  readers.interestDirect.mockReturnValue(null);
  readers.custody.mockReturnValue(configured);
}

beforeEach(() => {
  vi.resetAllMocks();
  allIntakesReady();
});

describe('collectPrimaryIntakeEvidence', () => {
  it('reports no family not ready when every intake can take a replayed delivery', () => {
    expect(collectPrimaryIntakeEvidence(ENV, NOW)).toEqual({ notReady: [] });
  });

  it('asks every reader the way the replay does: intake mode, this host env, the check time', () => {
    collectPrimaryIntakeEvidence(ENV, NOW);
    expect(readers.bankInbox).toHaveBeenCalledWith('intake', ENV);
    expect(readers.interestInbox).toHaveBeenCalledWith('intake', ENV);
    expect(readers.custody).toHaveBeenCalledWith(ENV, NOW.getTime());
  });

  it('names every family whose intake is disabled or unconfigured on this host', () => {
    readers.bankInbox.mockImplementation(off);
    readers.interestInbox.mockImplementation(off);
    readers.custody.mockImplementation(off);
    expect(collectPrimaryIntakeEvidence(ENV, NOW)).toEqual({
      notReady: ['bank', 'custody', 'interest'],
    });
  });

  describe('bank', () => {
    it('is ready on the inflow runtime alone when the inbox is switched off', () => {
      readers.bankInbox.mockImplementation(off);
      readers.inflow.mockReturnValue(configured);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual([]);
    });

    it('is not ready when the inbox and the inflow runtime are both off', () => {
      readers.bankInbox.mockImplementation(off);
      readers.inflow.mockImplementation(off);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual(['bank']);
    });

    it('is not ready when the inbox is on but misconfigured, even if the inflow runtime is ready', () => {
      // The inbox intake answers 503 on a configuration error; the replay
      // never falls through to the inflow runtime after that.
      readers.bankInbox.mockImplementation(broken);
      readers.inflow.mockReturnValue(configured);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual(['bank']);
    });

    it('is not ready when the inbox is off and the inflow runtime is misconfigured', () => {
      readers.bankInbox.mockImplementation(off);
      readers.inflow.mockImplementation(broken);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual(['bank']);
    });

    it('is not ready when the inbox is configured but its direct fallback is broken', () => {
      readers.bankInbox.mockReturnValue(configured);
      readers.inflow.mockImplementation(broken);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual(['bank']);
    });

    it('is ready when the inbox is configured and the fallback is deliberately off', () => {
      readers.bankInbox.mockReturnValue(configured);
      readers.inflow.mockImplementation(off);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual([]);
    });

    it('records a broken inflow runtime independently of bank-key readiness', () => {
      readers.bankInbox.mockImplementation(off);
      readers.inflow.mockImplementation(broken);
      expect(collectPrimaryIntakeEvidence(ENV, NOW)).toEqual({
        notReady: ['bank'],
        legacyBankInflowUnavailable: true,
      });
    });

    it('omits the legacy signal when inflow is deliberately off', () => {
      readers.inflow.mockImplementation(off);
      expect(collectPrimaryIntakeEvidence(ENV, NOW)).toEqual({ notReady: [] });
    });

    it('exports the broken-only runtime probe', () => {
      readers.inflow.mockImplementation(broken);
      expect(isPrimaryLegacyBankInflowUnavailable(ENV)).toBe(true);
      readers.inflow.mockImplementation(off);
      expect(isPrimaryLegacyBankInflowUnavailable(ENV)).toBe(false);
    });
  });

  describe('interest', () => {
    it('is ready on the direct paid-interest runtime alone when the inbox is switched off', () => {
      readers.interestInbox.mockImplementation(off);
      readers.interestDirect.mockReturnValue(configured);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual([]);
      expect(readers.interestDirect).toHaveBeenCalledWith(ENV, 'intake');
    });

    it('is not ready when the inbox and the direct runtime are both off', () => {
      readers.interestInbox.mockImplementation(off);
      readers.interestDirect.mockImplementation(off);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual([
        'interest',
      ]);
    });

    it('is not ready when the inbox reader throws, even if the direct runtime is ready', () => {
      readers.interestInbox.mockImplementation(broken);
      readers.interestDirect.mockReturnValue(configured);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual([
        'interest',
      ]);
    });

    it('is not ready when the inbox is off and the direct runtime throws', () => {
      readers.interestInbox.mockImplementation(off);
      readers.interestDirect.mockImplementation(broken);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual([
        'interest',
      ]);
    });
  });

  describe('custody', () => {
    it('is not ready when the card custody intake is off or throws', () => {
      readers.custody.mockImplementation(off);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual([
        'custody',
      ]);
      readers.custody.mockImplementation(broken);
      expect(collectPrimaryIntakeEvidence(ENV, NOW).notReady).toEqual([
        'custody',
      ]);
    });
  });

  it('never puts configuration values in the evidence', () => {
    readers.bankInbox.mockReturnValue({ webhookSecret: 'must-not-leak' });
    readers.custody.mockImplementation(off);
    expect(
      JSON.stringify(collectPrimaryIntakeEvidence(ENV, NOW))
    ).not.toContain('must-not-leak');
  });
});

describe('primaryIntakeReason', () => {
  it('is not checked without worker-host evidence', () => {
    expect(primaryIntakeReason(undefined)).toBe('PRIMARY_INTAKE_NOT_CHECKED');
  });

  it('passes when no family is missing', () => {
    expect(primaryIntakeReason({ notReady: [] })).toBeNull();
  });

  it('names the families in a stable order', () => {
    expect(primaryIntakeReason({ notReady: ['bank', 'interest'] })).toBe(
      'PRIMARY_INTAKE_NOT_READY:bank,interest'
    );
  });
});
