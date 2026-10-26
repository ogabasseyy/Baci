import { NativeModules } from 'react-native';
import { setSavingsActivityOwner } from './savings-activity-lifecycle';
import { trackSavingsContribution } from './track-savings-contribution';

let mockOwner = 'user';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: mockOwner } }) },
}));
const track = jest.fn();
const goal = {
  id: '9f01153c-1589-4dde-b9aa-8f644a846832',
  title: 'Phone',
  current_amount: 100,
  target_amount: 1000,
  contribution_amount: 100,
  contribution_frequency: 'monthly',
  source_mode: 'manual',
  status: 'active',
  maturity_date: '2027-10-13',
} as const;

beforeEach(() => {
  mockOwner = 'user';
  setSavingsActivityOwner('user');
  track.mockClear();
  NativeModules.SavingsLiveActivity = { track };
});

it('ends only after confirmation and uses the refreshed server balance', async () => {
  await trackSavingsContribution(
    goal,
    async () => ({ status: 'confirmed' }),
    async () => ({ ...goal, current_amount: 200 })
  );
  expect(track.mock.calls.map((call) => call[4])).toEqual([
    'pending',
    'confirmed',
  ]);
  expect(track).toHaveBeenLastCalledWith(
    goal.id,
    'Phone',
    200,
    1000,
    'confirmed'
  );
});

it('never announces success for a pending result or ambiguous failure', async () => {
  await trackSavingsContribution(goal, async () => ({ status: 'pending' }));
  await expect(
    trackSavingsContribution(goal, async () => {
      throw new Error('timeout');
    })
  ).rejects.toThrow('timeout');
  expect(track.mock.calls.map((call) => call[4])).toEqual([
    'pending',
    'pending',
    'pending',
    'unknown',
  ]);
});

it('does not recreate financial activity after the initiating user signs out', async () => {
  await trackSavingsContribution(goal, async () => {
    mockOwner = 'other-user';
    setSavingsActivityOwner(null);
    return { status: 'confirmed' };
  });
  expect(track).toHaveBeenCalledTimes(1);
});

it('fences a delayed contribution completion when the account switches', async () => {
  let finish!: (value: { status: string }) => void;
  const pending = trackSavingsContribution(
    goal,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  expect(track).toHaveBeenCalledTimes(1);
  setSavingsActivityOwner('next-user');
  mockOwner = 'next-user';
  finish({ status: 'confirmed' });
  await pending;
  expect(track).toHaveBeenCalledTimes(1);
});

it('keeps successful transfers successful when native presentation is unavailable', async () => {
  track.mockImplementationOnce(() => {
    throw new Error('unavailable');
  });
  await expect(
    trackSavingsContribution(goal, async () => ({ status: 'confirmed' }))
  ).resolves.toEqual({ status: 'confirmed' });
});

it('does not mark an unsuccessful legacy response as confirmed', async () => {
  await trackSavingsContribution(goal, async () => ({ success: false }));
  expect(track).toHaveBeenLastCalledWith(
    goal.id,
    'Phone',
    100,
    1000,
    'unknown'
  );
});
