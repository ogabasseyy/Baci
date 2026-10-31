import 'server-only';
import { primarySavingsProvisioningSchemas as schemas } from '@/schemas/primary-savings-provisioning';
import { PiggyvestApiError } from './client';
import type { createPrimarySavingsProvisioningStore } from './primary-savings-provisioning-store';
import { matchesProviderWalletName } from './provider-wallet-name';
import type { CreatePiggyvestWalletInput } from './wallets';

/**
 * Goal interest belongs to the customer (or is declined), never to the main
 * wallet's Ogabassey payout: the request type forbids a payout wallet and
 * makes accrual an explicit choice.
 */
type GoalWalletRequest = Omit<
  CreatePiggyvestWalletInput,
  'enableInterestAccrual' | 'interestPayoutWallet'
> & { enableInterestAccrual: boolean; interestPayoutWallet?: never };

type Input = {
  scope: unknown;
  goalId: string;
  mode: 'provision' | 'recover';
  interestAccepted?: boolean;
  store: ReturnType<typeof createPrimarySavingsProvisioningStore>;
  createWallet: (request: GoalWalletRequest) => Promise<unknown>;
  listWallets: (customerId: string) => Promise<unknown>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
  retrieveAccounts: (walletId: string) => Promise<unknown>;
};

export async function provisionPrimarySavingsWallet(input: Input) {
  const scope = schemas.scope.parse(input.scope);
  const goalId = schemas.goalId.parse(input.goalId);
  let interestAccepted: boolean | null = null;
  const outcome = (
    status:
      | 'pending'
      | 'ready'
      | 'conflict'
      | 'not_found'
      | 'rejected'
      | 'unavailable',
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
      // deterministic (PiggyVest may strip its punctuation, so it matches
      // on letters and digits), so adopt a listed match instead of reposting —
      // subaccount_name is provider-unique, so a repost would be rejected
      // as a duplicate and strand recovery for another request. A list
      // failure falls through to creation: failing closed here would turn
      // a transient list outage into a provisioning outage. `prelisted`
      // stays null unless a complete listing answered.
      let prelisted: { id: string }[] | null = null;
      const walletName = intent.walletName;
      const providerCustomerId = intent.providerCustomerId;
      try {
        const listed = await input.listWallets(providerCustomerId);
        prelisted =
          listed === null
            ? null
            : schemas.wallets
                .parse(listed)
                .filter((wallet) =>
                  matchesProviderWalletName(wallet.name, walletName)
                );
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
        } catch (error) {
          await input.store.record(goalId, intent.claimToken, null);
          // A 422 decline envelope ("One or more validation errors
          // occurred") counts as "nothing created" only after a complete
          // pre-list proved the name absent; otherwise it may be refusing a
          // duplicate of a wallet an earlier attempt created. No money moves
          // on this path. The intent is stored unknown (no terminal state
          // exists), so status reads say pending and prepare_goal_wallet
          // re-claims it after five minutes: a later setup sends one fresh
          // create, never an automatic retry from here.
          return outcome(
            prelisted !== null && isValidationDecline(error)
              ? 'rejected'
              : 'pending'
          );
        }
      }
      intent = await input.store.read(goalId);
      if (!intent) return outcome('unavailable');
    }
    const listed = await input.listWallets(intent.providerCustomerId);
    // An incomplete listing proves nothing: keep waiting, never conclude.
    if (listed === null) return outcome('pending');
    const candidates = schemas.wallets
      .parse(listed)
      .filter((wallet) =>
        matchesProviderWalletName(wallet.name, intent.walletName)
      );
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
      !matchesProviderWalletName(wallet.name, intent.walletName)
    )
      return outcome('conflict');
    // Whether a goal with no payout of its own inherits the customer's
    // Ogabassey payout wallet is unproven (p7), so a readback naming any
    // payout outside the customer's own wallets never enrolls.
    const payout = wallet.interest_payout_wallet ?? null;
    if (
      payout !== null &&
      payout !== wallet.id &&
      payout !== intent.primaryWalletId
    )
      return outcome('conflict');
    // A declined goal must never be funded while the provider shows it
    // accruing (customers are now created with accrual on, and goal
    // inheritance is unproven). Null or absent is not evidence either way.
    if (wallet.interest_enabled === true && !intent.interestAccepted)
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
      // enroll_goal_wallet compares it on lowercase letters and digits only
      // (migration 20261031210000), like matchesProviderWalletName, so a
      // name PiggyVest rewrote still enrols; an ambiguous name is refused.
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

function isValidationDecline(error: unknown) {
  return (
    error instanceof PiggyvestApiError && error.status === 422 && error.declined
  );
}
