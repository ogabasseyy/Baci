import { z } from 'zod';
import { piggyvestRequest } from '@/lib/piggyvest/client';
import { resolvePiggyvestStagingSyntheticIdentity } from '@/lib/piggyvest/staging-synthetic-identity';
import {
  listBanks,
  resolveAccountName,
  transferToWallet,
} from '@/lib/piggyvest/transfers';
import { ProviderApi, type QaIdentity } from './provider-ops';

/**
 * Proof-only mutations the typed client has no input for. Each still goes
 * through MutationGate: journaled intent first, exact body match at send
 * time, single-use permit, and a slot that is never resent.
 */

export interface BvnCollisionIdentity {
  bvn: string;
  email: string;
  phone: string;
  name: string;
  thirdPartyIdentifier: string;
}

/**
 * Proof 1's second identity: the QA key's own synthetic BVN under another
 * third_party_identifier, email and phone (all derived from the QA key, all
 * in the synthetic ranges), so only the BVN collides.
 */
export function bvnCollisionIdentity(qa: QaIdentity): BvnCollisionIdentity {
  const base = resolvePiggyvestStagingSyntheticIdentity(qa.qaKey);
  const other = resolvePiggyvestStagingSyntheticIdentity(
    `${qa.qaKey}:bvn-collision`
  );
  return {
    bvn: base.bvn,
    email: other.email.toLowerCase(),
    phone: other.phone,
    name: other.name.normalize('NFKC'),
    thirdPartyIdentifier: `${qa.thirdPartyIdentifier}:bvnalt`,
  };
}

export class ProofApi extends ProviderApi {
  /** GET /transfer/bank-list (proof 4's destination check). */
  banks() {
    return this.runCall(() => listBanks(this.config));
  }

  /** GET /transfer/name-enquiry for the operator-supplied destination. */
  nameEnquiry(bankCode: string, accountNumber: string) {
    return this.runCall(() =>
      resolveAccountName(this.config, { bankCode, accountNumber })
    );
  }

  /** POST /customers?returnIfExist=true with a BVN that already has a customer. */
  createCustomerSameBvn(qa: QaIdentity, slot: string) {
    const identity = bvnCollisionIdentity(qa);
    return this.mutate(
      {
        slot,
        op: 'create_customer',
        path: '/api/v1/customers',
        qaKey: qa.qaKey,
        bodyMatch: {
          bvn: identity.bvn,
          email: identity.email,
          third_party_identifier: identity.thirdPartyIdentifier,
        },
        walletIds: [],
        amountKobo: null,
      },
      () =>
        piggyvestRequest(this.config, z.unknown(), '/api/v1/customers', {
          body: {
            bvn: identity.bvn,
            email: identity.email,
            name: identity.name,
            phone: identity.phone,
            third_party_identifier: identity.thirdPartyIdentifier,
            enable_interest_accrual: true,
          },
          query: { returnIfExist: 'true' },
        })
    );
  }

  /**
   * Proof 2 only: the same body with the SAME reference as an earlier transfer
   * of this QA key. The gate refuses any reference it did not see accepted.
   */
  transferWalletAgain(
    qa: QaIdentity,
    source: string,
    destination: string,
    amountKobo: number,
    reference: string,
    slot: string,
    originalSlot: string
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
        reuseReference: reference,
        reuseOfSlot: originalSlot,
      },
      (sentReference) =>
        transferToWallet(this.config, {
          amountKobo,
          sourceWalletId: source,
          destinationWalletId: destination,
          reference: sentReference,
        })
    );
  }
}
