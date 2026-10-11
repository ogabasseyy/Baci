import 'server-only';
import { primarySavingsProvisioningSchemas as schemas } from '@/schemas/primary-savings-provisioning';
import type { createPrimarySavingsProvisioningStore } from './primary-savings-provisioning-store';
import type { CreatePiggyvestWalletInput } from './wallets';

type Input = {
  scope: unknown;
  goalId: string;
  mode: 'provision' | 'recover';
  interestAccepted?: boolean;
  store: ReturnType<typeof createPrimarySavingsProvisioningStore>;
  createWallet: (request: CreatePiggyvestWalletInput) => Promise<unknown>;
  listWallets: (customerId: string) => Promise<unknown>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
  retrieveAccounts: (walletId: string) => Promise<unknown>;
};

export async function provisionPrimarySavingsWallet(input: Input) {
  const scope = schemas.scope.parse(input.scope);
  const goalId = schemas.goalId.parse(input.goalId);
  let interestAccepted: boolean | null = null;
  const outcome = (
    status: 'pending' | 'ready' | 'conflict' | 'not_found' | 'unavailable',
    accounts: {
      accountNumber: string;
      accountName: string;
      bankName: string;
    }[] = []
  ) => ({
    goalId,
    status,
    interestAccepted,
    accounts,
    interestEnrollment:
      interestAccepted === null
        ? 'unknown'
        : interestAccepted
          ? 'requested'
          : 'not_requested',
  });
  try {
    if (input.mode === 'provision')
      interestAccepted = schemas.interestAccepted.parse(input.interestAccepted);
    let intent = await (input.mode === 'provision'
      ? input.store.prepare(
          goalId,
          schemas.interestAccepted.parse(interestAccepted)
        )
      : input.store.read(goalId));
    if (!intent) return outcome('not_found');
    interestAccepted = intent.interestAccepted;
    if (
      input.mode === 'provision' &&
      interestAccepted !== input.interestAccepted
    )
      return outcome('conflict');
    if (intent.walletName !== `baci-save:${scope.integrationId}:${goalId}`)
      return outcome('conflict');
    if (intent.status === 'conflict') return outcome('conflict');
    if (intent.status === 'claimed') {
      if (input.mode !== 'provision' || !intent.claimToken)
        return outcome('unavailable');
      // A reclaimed claim may already have its wallet at the provider:
      // creation succeeded but the response was lost. The wallet name is
      // deterministic, so adopt a listed match instead of reposting —
      // subaccount_name is provider-unique, so a repost would be rejected
      // as a duplicate and strand recovery for another request. A list
      // failure falls through to creation: failing closed here would turn
      // a transient list outage into a provisioning outage.
      let prelisted: { id: string }[] | null = null;
      const walletName = intent.walletName;
      const providerCustomerId = intent.providerCustomerId;
      try {
        prelisted = schemas.wallets
          .parse(await input.listWallets(providerCustomerId))
          .filter((wallet) => wallet.name === walletName);
      } catch {
        prelisted = null;
      }
      if (prelisted !== null && prelisted.length > 1)
        return outcome('conflict');
      if (prelisted !== null && prelisted.length === 1) {
        if (
          !(await input.store.record(
            goalId,
            intent.claimToken,
            prelisted[0].id
          ))
        )
          return outcome('unavailable');
      } else {
        try {
          const created = schemas.created.parse(
            await input.createWallet({
              customerId: intent.providerCustomerId,
              subaccountName: intent.walletName,
              reserveVirtualAccount: true,
              enableInterestAccrual: intent.interestAccepted,
            })
          );
          if (
            !(await input.store.record(goalId, intent.claimToken, created.id))
          )
            return outcome('unavailable');
        } catch {
          await input.store.record(goalId, intent.claimToken, null);
          return outcome('pending');
        }
      }
      intent = await input.store.read(goalId);
      if (!intent) return outcome('unavailable');
    }
    const candidates = schemas.wallets
      .parse(await input.listWallets(intent.providerCustomerId))
      .filter((wallet) => wallet.name === intent.walletName);
    if (candidates.length === 0) return outcome('pending');
    if (candidates.length !== 1) return outcome('conflict');
    const candidate = candidates[0];
    if (
      (intent.providerWalletId !== null &&
        candidate.id !== intent.providerWalletId) ||
      candidate.id === intent.primaryWalletId
    )
      return outcome('conflict');
    const wallet = schemas.wallet.parse(
      await input.retrieveWallet(candidate.id)
    );
    // The owning provider customer is part of the evidence binding: a
    // wallet with the expected ID, business, and name that belongs to a
    // different customer must never enroll, or contributions would land
    // in another customer's wallet.
    if (
      wallet.id !== candidate.id ||
      wallet.api_customer_id !== intent.providerCustomerId ||
      wallet.business_id !== scope.businessId ||
      wallet.name !== intent.walletName
    )
      return outcome('conflict');
    if (wallet.status !== 'active') return outcome('pending');
    const accounts = await input.retrieveAccounts(wallet.id);
    const parsedAccounts = schemas.accounts.safeParse(accounts);
    if (!parsedAccounts.success) return outcome('pending');
    const enrolled = await input.store.enroll(goalId, {
      // Provider-returned identity, not the stored one: the database
      // compares it against the onboarding mapping as a second factor.
      providerCustomerId: wallet.api_customer_id,
      providerWalletId: wallet.id,
      walletName: wallet.name,
      businessId: wallet.business_id,
      currency: wallet.currency,
      status: wallet.status,
      type: wallet.type,
      hasFundingAccount: true,
      interestAccepted: intent.interestAccepted,
    });
    return enrolled
      ? outcome(
          'ready',
          parsedAccounts.data.map((account) => ({
            accountNumber: account.account_number,
            accountName: account.account_name,
            bankName: account.bank_name,
          }))
        )
      : outcome('conflict');
  } catch {
    return outcome('unavailable');
  }
}
