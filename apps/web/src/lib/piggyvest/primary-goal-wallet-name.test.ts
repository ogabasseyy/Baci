import { describe, expect, it, vi } from 'vitest';
import { buildPiggyvestPlanWalletName } from './plan-wallet-name';
import {
  buildPrimaryGoalWalletName,
  isPrimaryGoalWalletName,
} from './primary-goal-wallet-name';
import { matchesProviderWalletName } from './provider-wallet-name';
import { PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS } from './provider-wallet-name.constants';

vi.mock('server-only', () => ({}));

const integrationId = '00000000-0000-4000-8000-000000000004';
const goalId = '00000000-0000-4000-8000-000000000006';
// Pinned on both sides: supabase/tests/piggyvest_primary_goal_wallet_short_name.sql
// asserts prepare_goal_wallet returns this exact name for the same ids.
const GOLDEN = 'baci-save-d80a9fbb7f8c666ce4462294b4e53d25';

describe('primary goal wallet name', () => {
  it('is the pinned 42-character name shared with prepare_goal_wallet', () => {
    expect(buildPrimaryGoalWalletName(integrationId, goalId)).toBe(GOLDEN);
    expect(GOLDEN).toHaveLength(42);
  });

  it('fits the 50-character PiggyVest subaccount_name limit', () => {
    // 51 or more is refused with 422 (staging probe, 2026-10-31).
    expect(PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS).toBe(50);
    for (let n = 0; n < 50; n++) {
      const goal = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      expect(
        buildPrimaryGoalWalletName(integrationId, goal).length
      ).toBeLessThanOrEqual(PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS);
    }
  });

  it('is unique per integration and goal, and ignores UUID case', () => {
    const other = '00000000-0000-4000-8000-000000000007';
    expect(buildPrimaryGoalWalletName(integrationId, other)).not.toBe(GOLDEN);
    expect(buildPrimaryGoalWalletName(other, goalId)).not.toBe(GOLDEN);
    expect(
      buildPrimaryGoalWalletName(
        integrationId.toUpperCase(),
        goalId.toUpperCase()
      )
    ).toBe(GOLDEN);
  });

  it.each([
    GOLDEN.replaceAll('-', ''),
    GOLDEN.replaceAll('-', '').toUpperCase(),
    'BACI SAVE D80A9FBB7F8C666CE4462294B4E53D25',
  ])('matches the provider-listed stripped form %j', (listed) => {
    expect(matchesProviderWalletName(listed, GOLDEN)).toBe(true);
  });

  it('never matches the legacy plan-wallet name for the same goal', () => {
    const legacy = buildPiggyvestPlanWalletName({ integrationId, goalId });
    expect(matchesProviderWalletName(legacy, GOLDEN)).toBe(false);
    expect(matchesProviderWalletName(GOLDEN, legacy)).toBe(false);
  });

  it('does not match the old 83-character name', () => {
    expect(
      matchesProviderWalletName(`baci-save:${integrationId}:${goalId}`, GOLDEN)
    ).toBe(false);
  });

  describe('stored name check', () => {
    const legacy = `baci-save:${integrationId}:${goalId}`;
    const goal = (hasProviderWallet: boolean) => ({
      integrationId,
      goalId,
      hasProviderWallet,
    });

    it.each([
      true,
      false,
    ])('accepts the current name whether or not a wallet is held (%s)', (held) => {
      expect(isPrimaryGoalWalletName(GOLDEN, goal(held))).toBe(true);
    });

    it('accepts the legacy name only on an intent that holds a provider wallet', () => {
      expect(isPrimaryGoalWalletName(legacy, goal(true))).toBe(true);
      expect(isPrimaryGoalWalletName(legacy.toUpperCase(), goal(true))).toBe(
        true
      );
      expect(isPrimaryGoalWalletName(legacy, goal(false))).toBe(false);
    });

    it.each([
      `baci-save:${integrationId}:00000000-0000-4000-8000-000000000007`,
      buildPrimaryGoalWalletName(
        integrationId,
        '00000000-0000-4000-8000-000000000007'
      ),
      'baci-save',
    ])('refuses another goal name %j', (name) => {
      expect(isPrimaryGoalWalletName(name, goal(true))).toBe(false);
    });
  });
});
