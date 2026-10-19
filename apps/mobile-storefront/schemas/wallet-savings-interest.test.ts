import {
  WalletSavingsInterestRequestSchema,
  WalletSavingsInterestResponseSchema,
} from './wallet-savings-interest';

const goalId = '10000000-0000-4000-8000-000000000001';

it('requires a merchant UUID and the explicit goals overload before any RPC', () => {
  expect(
    WalletSavingsInterestRequestSchema.safeParse({
      p_merchant_id: goalId,
      p_include_goals: true,
    }).success
  ).toBe(true);
  expect(
    WalletSavingsInterestRequestSchema.safeParse({
      p_merchant_id: 'unverified-merchant',
      p_include_goals: true,
    }).success
  ).toBe(false);
});

it('accepts bounded aggregate and per-goal paid-interest amounts', () => {
  expect(
    WalletSavingsInterestResponseSchema.parse({
      credited_interest_kobo: 733,
      goal_interest_kobo: [{ goal_id: goalId, credited_interest_kobo: 733 }],
    }).credited_interest_kobo
  ).toBe(733);
});

it.each([
  { credited_interest_kobo: -1, goal_interest_kobo: [] },
  { credited_interest_kobo: 1.5, goal_interest_kobo: [] },
  {
    credited_interest_kobo: Number.MAX_SAFE_INTEGER + 1,
    goal_interest_kobo: [],
  },
  {
    credited_interest_kobo: 733,
    goal_interest_kobo: [
      { goal_id: goalId, credited_interest_kobo: 400 },
      { goal_id: goalId, credited_interest_kobo: 333 },
    ],
  },
  {
    credited_interest_kobo: 733,
    goal_interest_kobo: [],
    unexpected: true,
  },
  {
    credited_interest_kobo: 732,
    goal_interest_kobo: [{ goal_id: goalId, credited_interest_kobo: 733 }],
  },
  {
    credited_interest_kobo: 733,
    goal_interest_kobo: [
      { goal_id: 'not-a-uuid', credited_interest_kobo: 733 },
    ],
  },
])('rejects malformed or inconsistent interest payloads: %j', (payload) => {
  expect(WalletSavingsInterestResponseSchema.safeParse(payload).success).toBe(
    false
  );
});
