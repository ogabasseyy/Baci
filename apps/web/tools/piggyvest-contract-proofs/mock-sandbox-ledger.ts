import { accruedInterestReply } from './mock-accruals';
import { pageWindow } from './mock-paging';
import type { MockSandbox } from './mock-sandbox';
import { listedTransactions, markStaleBalance } from './mock-sandbox-lag';
import {
  type Body,
  fail,
  type MockReply,
  ok,
  type Txn,
  ulid,
} from './mock-sandbox-types';

/** Funding, transfers, TSQ, transaction list and interest reads. */
export class MockLedger {
  private txns: Txn[] = [];

  constructor(private readonly host: MockSandbox) {}

  /** Ground truth for tests: debit plus credit rows a wallet has, shown or not. */
  rowCount(walletId: string): number {
    return this.txns.reduce(
      (sum, t) =>
        sum +
        (t.source === walletId ? 1 : 0) +
        (t.destination === walletId ? 1 : 0),
      0
    );
  }

  fund(body: Body): MockReply {
    const w = this.host.wallet(body.wallet_id);
    const amount = Number(body.amount);
    if (!w || !Number.isInteger(amount) || amount <= 0 || amount > 10_000_000)
      return fail('Funding failed');
    if (this.host.options.fundingSettles) {
      const fee = this.host.options.depositFeeKobo;
      markStaleBalance(w, this.host.options.balanceLagReads);
      w.balance += this.host.options.depositFeeBorneByWallet
        ? amount - fee
        : amount;
      const n = this.host.id();
      this.txns.push({
        id: ulid('t', n),
        creditId: ulid('c', n),
        reference: null,
        category: 'inflow_transaction',
        source: null,
        destination: w.id,
        amount,
        fee,
        status: 'success',
        polls: 0,
        hiddenReads: this.host.options.listLagReads,
        createdAt: this.host.now(),
      });
    }
    return ok(undefined, 'Funding Processing');
  }

  transfer(kind: 'wallet' | 'bank', body: Body): MockReply {
    const source = this.host.wallet(body.source);
    const amount = Number(body.amount);
    const destination =
      kind === 'wallet' ? this.host.wallet(body.destination) : undefined;
    const reference = String(body.reference ?? '');
    const fee =
      kind === 'wallet'
        ? this.host.options.transferFeeKobo
        : this.host.options.bankFeeKobo;
    if (
      !source ||
      (kind === 'wallet' && !destination) ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      return fail(`An error occurred processing ${kind} transfer`);
    }
    if (this.txns.some((t) => t.reference === reference))
      return fail('Duplicate reference');
    if (source.balance < amount + (kind === 'bank' ? fee : 0))
      return fail('Insufficient funds');
    const n = this.host.id();
    this.txns.push({
      id: ulid('t', n),
      creditId: ulid('c', n),
      reference,
      category: kind === 'wallet' ? 'p2p' : 'bank-outflow',
      source: source.id,
      destination: destination?.id ?? null,
      amount,
      fee,
      status: 'pending',
      polls: 0,
      hiddenReads: this.host.options.listLagReads,
      createdAt: this.host.now(),
    });
    return {
      status: 202,
      body: {
        status: true,
        message:
          kind === 'wallet'
            ? 'Peer to Peer Wallet transfer processing'
            : 'Bank transfer is processing',
      },
    };
  }

  /** Goal (non-default) wallets may lag differently from the default one. */
  private counterLagFor(walletId: string, customerId: string): number {
    const { counterLagReads, counterLagReadsGoal } = this.host.options;
    const isDefault =
      this.host.customers.find((c) => c.id === customerId)?.defaultWalletId ===
      walletId;
    return !isDefault && counterLagReadsGoal !== null
      ? counterLagReadsGoal
      : counterLagReads;
  }

  private settle(txn: Txn): void {
    txn.status = 'success';
    const source = this.host.wallet(txn.source);
    const destination = this.host.wallet(txn.destination);
    for (const touched of [source, destination]) {
      if (touched) markStaleBalance(touched, this.host.options.balanceLagReads);
    }
    if (source)
      source.balance -=
        txn.amount + (txn.category === 'bank-outflow' ? txn.fee : 0);
    if (destination) destination.balance += txn.amount;
    const bumps =
      txn.category === 'bank-outflow'
        ? this.host.options.bankIncrementsCounter
        : this.host.options.w2wIncrementsCounter;
    if (source && bumps) {
      const scope =
        this.host.options.counterScope === 'customer'
          ? this.host.wallets.filter((w) => w.customerId === source.customerId)
          : [source];
      for (const wallet of scope) {
        const lag = this.counterLagFor(wallet.id, wallet.customerId);
        if (lag > 0) {
          wallet.lagged = {
            count: (wallet.lagged?.count ?? 0) + 1,
            readsLeft: lag,
          };
        } else {
          wallet.withdrawalCount += 1;
        }
      }
    }
  }

  verify(query: URLSearchParams): MockReply {
    const txn = this.txns.find((t) => t.reference === query.get('reference'));
    const notFound = fail('Transaction not found', 404);
    if (!txn) return notFound;
    txn.polls += 1;
    if (txn.polls <= this.host.options.tsqNotFoundPolls) return notFound;
    const pendingPolls =
      txn.category === 'bank-outflow'
        ? (this.host.options.tsqPendingPollsBank ??
          this.host.options.tsqPendingPolls)
        : this.host.options.tsqPendingPolls;
    if (txn.polls <= this.host.options.tsqNotFoundPolls + pendingPolls) {
      if (this.host.options.tsqSettleEarly && txn.status === 'pending')
        this.settle(txn);
      return ok(this.tsqData(txn, 'pending'), 'Transaction status retrieved');
    }
    if (txn.status === 'pending') this.settle(txn);
    return ok(this.tsqData(txn, 'success'), 'Transaction status retrieved');
  }
  private tsqData(txn: Txn, status: string) {
    const base = {
      reference: txn.reference,
      status,
      amount: txn.amount,
      created_at: txn.createdAt,
    };
    return this.host.options.tsqShape === 'docs'
      ? { ...base, recipient: '0123456789', bank: 'Sandbox Bank' }
      : {
          ...base,
          currency: 'NGN',
          fee: txn.fee,
          source_wallet: txn.source,
          destination_wallet: txn.destination,
        };
  }

  listTransactions(query: URLSearchParams): MockReply {
    const limit = Number(query.get('limit') ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return fail('limit must be between 1 and 100');
    const walletId = query.get('wallet_id');
    interface Row {
      t: Txn;
      id: string;
      type: 'debit' | 'credit';
      wallet: string | null;
    }
    const rows: Row[] = listedTransactions(this.txns)
      .flatMap((t): Row[] => [
        ...(t.source
          ? [{ t, id: t.id, type: 'debit' as const, wallet: t.source }]
          : []),
        ...(t.destination || t.category === 'inflow_transaction'
          ? [
              {
                t,
                id: t.creditId,
                type: 'credit' as const,
                wallet: t.destination,
              },
            ]
          : []),
      ])
      .filter((row) => !walletId || row.wallet === walletId)
      .reverse();
    const window = pageWindow(
      this.host.options.pagingMode,
      query.get('cursor'),
      limit,
      rows.length
    );
    const page = rows.slice(window.start, window.end);
    return ok({
      edges: page.map(({ t, id, type, wallet }) => ({
        id,
        amount: t.amount,
        type,
        status: t.status === 'success' ? 'successful' : 'pending',
        category: t.category,
        description: 'sandbox',
        wallet_id: wallet,
        wallet_type: 'api',
        created_at: t.createdAt,
        third_party_reference: t.reference,
        peer_reference_id: null,
        batch_transaction_id: null,
      })),
      pageInfo: {
        hasNextPage: window.hasNextPage,
        endCursor: window.endCursor,
        previousCursor: window.previousCursor,
      },
    });
  }

  transaction(id: string): MockReply {
    const t = this.txns.find((x) => x.id === id || x.creditId === id);
    if (!t) return fail('Transaction not found', 404);
    return ok({
      id,
      available_balance: 0,
      amount: t.amount,
      fee: t.fee,
      reference: t.id,
      category: t.category,
      third_party_reference: t.reference,
      customer_id: this.host.wallet(t.source ?? t.destination)?.customerId,
      source_wallet: t.source,
      destination_wallet: t.destination,
      narration: 'sandbox',
      internal_reference: t.id,
      status: t.status === 'success' ? 'successful' : 'pending',
      session_id: null,
      meta: {},
      created_at: t.createdAt,
      updated_at: t.createdAt,
      source_wallet_balance: this.host.wallet(t.source)?.balance ?? null,
      destination_wallet_balance:
        this.host.wallet(t.destination)?.balance ?? null,
    });
  }

  accruedInterest(walletId: string, query: URLSearchParams): MockReply {
    return accruedInterestReply(this.host.options, walletId, query);
  }
}
