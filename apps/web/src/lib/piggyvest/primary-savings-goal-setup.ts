import 'server-only';
import { primarySavingsProvisioningSchemas as schemas } from '@/schemas/primary-savings-provisioning';
import { provisionPrimarySavingsWallet } from './primary-savings-provisioning';

type ProvisionInput = Parameters<typeof provisionPrimarySavingsWallet>[0];

type SetupInput = Omit<ProvisionInput, 'mode' | 'interestAccepted'> & {
  /** The customer's explicit answer; only used when none is stored yet. */
  requestedInterest?: boolean;
};

/**
 * Finishes setup of a goal whose primary wallet was never provisioned (a
 * goal created before provisioning existed, or one whose provisioning failed).
 *
 * The goal's interest choice is never defaulted. A choice already stored for
 * the goal always wins; with none stored the customer's explicit boolean is
 * required and is stored by the claim. A stored choice that the client
 * contradicts is a conflict, not an overwrite.
 *
 * Status is read first. A goal with no setup record is not started and gets
 * a fresh claim; a goal whose claim has expired is reclaimed by the database
 * under the stored choice; a goal with a live claim, or one already
 * enrolled, only reports status. The claim, its expiry and ownership are
 * decided inside prepare_goal_wallet, under its own lock and clock.
 */
export async function setupPrimarySavingsGoal(input: SetupInput) {
  const { requestedInterest, ...rest } = input;
  const goalId = schemas.goalId.parse(input.goalId);
  const outcome = (
    status: 'choice_required' | 'conflict' | 'unavailable',
    interestAccepted: boolean | null = null
  ) => ({
    goalId,
    status,
    interestAccepted,
    accounts: [] as {
      accountNumber: string;
      accountName: string;
      bankName: string;
    }[],
    interestEnrollment: (interestAccepted === null
      ? 'unknown'
      : interestAccepted
        ? 'requested'
        : 'not_requested') as 'unknown' | 'requested' | 'not_requested',
  });
  let stored: boolean | null;
  try {
    stored = (await input.store.read(goalId))?.interestAccepted ?? null;
  } catch {
    return outcome('unavailable');
  }
  const requested =
    typeof requestedInterest === 'boolean' ? requestedInterest : null;
  if (stored !== null && requested !== null && requested !== stored)
    return outcome('conflict', stored);
  const choice = stored ?? requested;
  if (choice === null) return outcome('choice_required');
  return await provisionPrimarySavingsWallet({
    ...rest,
    mode: 'provision',
    interestAccepted: choice,
  });
}
