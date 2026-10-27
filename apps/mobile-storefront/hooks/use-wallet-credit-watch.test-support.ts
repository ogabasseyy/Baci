import type { WalletLedgerPosition } from '@/lib/wallet-funding-session';
import type { WalletTopUpCandidate } from './wallet-top-up-credit';

export function topUp(
  id: string,
  amount: number,
  createdAt: string
): WalletTopUpCandidate {
  return {
    amount,
    created_at: createdAt,
    id,
    source_type: 'wallet_topup',
    type: 'credit',
  };
}

export function positionOf(
  transaction: WalletTopUpCandidate
): WalletLedgerPosition {
  if (transaction.created_at === null) {
    throw new Error('Wallet credit watch fixtures need a dated top-up');
  }
  return {
    createdAt: Date.parse(transaction.created_at),
    id: transaction.id,
  };
}
