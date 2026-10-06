/**
 * Plan-wallet service seam for the mobile staging flow.
 *
 * The UI renders snapshots through this interface. The fixture
 * implementation below drives the full flow (none → provisioning → ready)
 * with synthetic data and no network, so the flow is tappable in Metro
 * with no PiggyVest credentials. The live implementation (backend route →
 * PiggyVest client) plugs into the same interface later without UI changes.
 *
 * All money fields are integer kobo. Never mix naira and kobo.
 */

export type PlanWalletStatus = 'none' | 'provisioning' | 'ready' | 'restricted';

export interface PlanWalletSnapshot {
  status: PlanWalletStatus;
  walletId: string | null;
  accountNumber: string | null;
  accountName: string | null;
  bankName: string | null;
  balanceKobo: number;
  paidInterestKobo: number;
  pendingAccrualKobo: number;
}

export interface PlanWalletService {
  getSnapshot(): Promise<PlanWalletSnapshot>;
  createWallet(): Promise<PlanWalletSnapshot>;
  refresh(): Promise<PlanWalletSnapshot>;
}

const EMPTY_SNAPSHOT: PlanWalletSnapshot = {
  status: 'none',
  walletId: null,
  accountNumber: null,
  accountName: null,
  bankName: null,
  balanceKobo: 0,
  paidInterestKobo: 0,
  pendingAccrualKobo: 0,
};

const SYNTHETIC_READY_SNAPSHOT: PlanWalletSnapshot = {
  status: 'ready',
  walletId: 'pvb-wallet-synthetic-001',
  accountNumber: '9000000001',
  accountName: 'SYNTHETIC PLAN WALLET',
  bankName: 'Synthetic Bank',
  balanceKobo: 9500000,
  paidInterestKobo: 300000,
  pendingAccrualKobo: 200000,
};

const SYNTHETIC_RESTRICTED_SNAPSHOT: PlanWalletSnapshot = {
  ...SYNTHETIC_READY_SNAPSHOT,
  status: 'restricted',
};

/**
 * Deterministic in-memory fixture. `createWallet` moves none → provisioning;
 * the next `refresh` settles provisioning → ready, mirroring the provider's
 * async creation (202 accepted, `create-wallet.success` arrives later).
 * Funding details are withheld until ready — the UI must never show an
 * account number while provisioning.
 */
export function createFixturePlanWalletService(
  initial: PlanWalletSnapshot = EMPTY_SNAPSHOT
): PlanWalletService {
  let current = initial;
  return {
    getSnapshot: () => Promise.resolve(current),
    createWallet: () => {
      if (current.status === 'none') {
        current = { ...EMPTY_SNAPSHOT, status: 'provisioning' };
      }
      return Promise.resolve(current);
    },
    refresh: () => {
      if (current.status === 'provisioning') {
        current = SYNTHETIC_READY_SNAPSHOT;
      }
      return Promise.resolve(current);
    },
  };
}

export const fixtureRestrictedSnapshot: PlanWalletSnapshot = {
  ...SYNTHETIC_RESTRICTED_SNAPSHOT,
};
