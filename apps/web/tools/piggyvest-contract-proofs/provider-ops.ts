import { z } from 'zod';
import { piggyvestRequest } from '@/lib/piggyvest/client';
import { createPiggyvestCustomer } from '@/lib/piggyvest/customers';
import { resolvePiggyvestStagingSyntheticIdentity } from '@/lib/piggyvest/staging-synthetic-identity';
import { transferToBank, transferToWallet } from '@/lib/piggyvest/transfers';
import { fundPiggyvestWalletTestMode } from '@/lib/piggyvest/wallet-funding';
import { createPiggyvestWallet } from '@/lib/piggyvest/wallets';
import type { MutationIntent } from './mutation-gate';
import type { JournalOutcome } from './mutation-journal';
import { type CallResult, ProviderReads } from './provider-reads';

export type { CallResult } from './provider-reads';

/**
 * Gated mutations on top of the read side. Every mutation goes through
 * MutationGate: journal intent first, then the typed client call, then the
 * journaled outcome.
 */

export interface QaIdentity {
  qaKey: string;
  thirdPartyIdentifier: string;
  goalWalletName: string;
}

export type MutationOutcome =
  | {
      kind: 'sent';
      reference: string;
      call: CallResult;
      outcome: JournalOutcome;
    }
  | { kind: 'resumed'; reference: string; priorOutcome: string };

export function qaIdentityFor(qaKey: string): QaIdentity {
  return {
    qaKey,
    thirdPartyIdentifier: `pvbproof:${qaKey}`,
    goalWalletName: `pvbproof-goal-${qaKey}`.slice(0, 120),
  };
}

/**
 * 408 (request timeout) and 429 (rate limited) are 4xx but are not a verdict
 * on the request: the provider may still have processed it. Only a definite
 * client-error decline is recorded as `rejected`; everything else stays
 * `indeterminate` until reconciled by a read.
 */
const NOT_A_VERDICT_STATUSES: ReadonlySet<number> = new Set([408, 429]);

export function classifyOutcome(call: CallResult): JournalOutcome {
  if (call.ok) return 'accepted';
  if (
    call.declined &&
    call.httpStatus !== null &&
    call.httpStatus >= 400 &&
    call.httpStatus < 500 &&
    !NOT_A_VERDICT_STATUSES.has(call.httpStatus)
  ) {
    return 'rejected';
  }
  return 'indeterminate';
}

export class ProviderApi extends ProviderReads {
  private async mutate(
    intent: MutationIntent,
    send: (reference: string) => Promise<unknown>
  ): Promise<MutationOutcome> {
    const begun = this.gate.begin(intent);
    if (begun.kind === 'resume') {
      return {
        kind: 'resumed',
        reference: begun.reference,
        priorOutcome: begun.outcome,
      };
    }
    let call: CallResult;
    try {
      call = await this.runCall(() => send(begun.reference));
    } catch (error) {
      this.gate.complete(begun.permit, 'indeterminate', null);
      throw error;
    }
    const outcome = classifyOutcome(call);
    this.gate.complete(begun.permit, outcome, call.httpStatus);
    return { kind: 'sent', reference: begun.reference, call, outcome };
  }

  createCustomer(qa: QaIdentity, slot: string) {
    const identity = resolvePiggyvestStagingSyntheticIdentity(qa.qaKey);
    return this.mutate(
      {
        slot,
        op: 'create_customer',
        path: '/api/v1/customers',
        qaKey: qa.qaKey,
        bodyMatch: { third_party_identifier: qa.thirdPartyIdentifier },
        walletIds: [],
        amountKobo: null,
      },
      () =>
        createPiggyvestCustomer(this.config, {
          ...identity,
          thirdPartyIdentifier: qa.thirdPartyIdentifier,
          returnIfExist: true,
          enableInterestAccrual: true,
        })
    );
  }

  /**
   * Proof 7 only. The typed `createPiggyvestCustomer` has no
   * `interest_payout_wallet` input, so this one call builds the body itself,
   * mirroring that function's field mapping. The payout wallet comes only from
   * operator config (never from a provider response) and is pinned in the
   * journaled intent.
   */
  createCustomerWithPayout(
    qa: QaIdentity,
    payoutWalletId: string,
    slot: string
  ) {
    const identity = resolvePiggyvestStagingSyntheticIdentity(qa.qaKey);
    return this.mutate(
      {
        slot,
        op: 'create_customer',
        path: '/api/v1/customers',
        qaKey: qa.qaKey,
        bodyMatch: {
          third_party_identifier: qa.thirdPartyIdentifier,
          enable_interest_accrual: true,
          interest_payout_wallet: payoutWalletId,
        },
        walletIds: [],
        amountKobo: null,
      },
      () =>
        piggyvestRequest(this.config, z.unknown(), '/api/v1/customers', {
          body: {
            bvn: identity.bvn,
            email: identity.email.toLowerCase(),
            name: identity.name.normalize('NFKC'),
            phone: identity.phone,
            third_party_identifier: qa.thirdPartyIdentifier,
            enable_interest_accrual: true,
            interest_payout_wallet: payoutWalletId,
          },
          query: { returnIfExist: 'true' },
        })
    );
  }

  createGoalWallet(
    qa: QaIdentity,
    customerId: string,
    slot: string,
    options: { nameSuffix?: string; payoutWalletId?: string } = {}
  ) {
    const subaccountName =
      `${qa.goalWalletName}${options.nameSuffix ?? ''}`.slice(0, 120);
    return this.mutate(
      {
        slot,
        op: 'create_wallet',
        path: '/api/v1/wallet/sub-account',
        qaKey: qa.qaKey,
        bodyMatch: {
          subaccount_name: subaccountName,
          customer_id: customerId,
          ...(options.payoutWalletId
            ? { interest_payout_wallet: options.payoutWalletId }
            : {}),
        },
        walletIds: [],
        amountKobo: null,
      },
      () =>
        createPiggyvestWallet(this.config, {
          subaccountName,
          customerId,
          reserveVirtualAccount: true,
          enableInterestAccrual: true,
          interestPayoutWallet: options.payoutWalletId,
        })
    );
  }

  fundWallet(
    qa: QaIdentity,
    walletId: string,
    amountKobo: number,
    slot: string
  ) {
    return this.mutate(
      {
        slot,
        op: 'test_funding',
        path: '/api/v1/transfer/test/funding',
        qaKey: qa.qaKey,
        bodyMatch: { wallet_id: walletId, amount: amountKobo },
        walletIds: [walletId],
        amountKobo,
      },
      () => fundPiggyvestWalletTestMode(this.config, { walletId, amountKobo })
    );
  }

  transferWallet(
    qa: QaIdentity,
    source: string,
    destination: string,
    amountKobo: number,
    slot: string
  ) {
    return this.mutate(
      {
        slot,
        op: 'wallet_transfer',
        path: '/api/v1/transfer/wallet',
        qaKey: qa.qaKey,
        bodyMatch: { source, destination, amount: amountKobo },
        walletIds: [source, destination],
        amountKobo,
        referenceField: 'reference',
      },
      (reference) =>
        transferToWallet(this.config, {
          amountKobo,
          sourceWalletId: source,
          destinationWalletId: destination,
          reference,
        })
    );
  }

  transferBank(
    qa: QaIdentity,
    source: string,
    destination: { bankCode: string; accountNumber: string },
    amountKobo: number,
    slot: string
  ) {
    return this.mutate(
      {
        slot,
        op: 'bank_transfer',
        path: '/api/v1/transfer/bank',
        qaKey: qa.qaKey,
        bodyMatch: {
          source,
          amount: amountKobo,
          bankCode: destination.bankCode,
          accountNumber: destination.accountNumber,
        },
        walletIds: [source],
        amountKobo,
        referenceField: 'reference',
      },
      (reference) =>
        transferToBank(this.config, {
          amountKobo,
          sourceWalletId: source,
          accountNumber: destination.accountNumber,
          bankCode: destination.bankCode,
          reference,
        })
    );
  }
}
