import type { WalletPayAnswer } from '@/lib/piggyvest/wallet-pay-http';
import type { WalletPayRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import type { walletPayScope } from '@/lib/piggyvest/wallet-pay-scope';
import type { DeliverVtuWalletPaymentDeps } from './deliver-vtu-wallet-payment';

type Identity = { merchantId: string; customerId: string; userId: string };
type Scope = ReturnType<typeof walletPayScope>;
type Issued =
  | {
      status: 'issued';
      operationId: string;
      amountKobo: number;
      expiresAt?: string;
    }
  | {
      status: 'pending' | 'confirmed' | 'needs_review';
      operationId: string;
      amountKobo: number;
    }
  | { status: 'unavailable' | 'conflict' };

export interface VtuWalletPayStepDeps {
  /** The caller's own purchase: PiggyVest-paid or not, and its amount. */
  readPurchase: (transactionId: string) => Promise<{
    piggyvestPaid: boolean;
    amount: number;
    /** The row's status; only a pending row may get a new payment. */
    status?: string;
    merchantId?: string;
    customerId?: string;
  } | null>;
  readRuntime: () => WalletPayRuntime | null;
  readRecoveryRuntime: () => WalletPayRuntime;
  resolveIdentity: (runtime: WalletPayRuntime) => Promise<Identity | null>;
  findForPurchase: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    purpose: 'vtu';
    purchaseRef: string;
  }) => Promise<{ operationId: string; state: string } | null>;
  issue: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    request: { purpose: 'vtu'; purchaseRef: string; amountKobo: number };
  }) => Promise<Issued>;
  check: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    operationId: string;
  }) => Promise<{
    state: string;
    purpose: string;
    purchaseRef: string;
    amountKobo: number;
  } | null>;
  pay: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    operationId: string;
    pinProof: string;
  }) => Promise<WalletPayAnswer>;
  delivery: (
    runtime: WalletPayRuntime
  ) => Omit<DeliverVtuWalletPaymentDeps, 'fulfil'>;
  /** Closes the purchase once its payment ended unpaid (best effort). */
  /** Closes the caller's own purchase refused before any payment existed. */
  closeUnissued: (transactionId: string) => Promise<boolean>;
  closeUnpaid: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    transactionId: string;
    cancelOperationId?: string;
  }) => Promise<boolean>;
}
