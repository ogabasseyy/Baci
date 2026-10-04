import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type SavingsReminderRequest,
  savingsReminderStorage,
} from './savings-reminder-storage';

jest.mock('@/lib/storage', () => {
  const storage = require('@react-native-async-storage/async-storage');
  return { asyncStorage: storage.default ?? storage };
});

const pending: SavingsReminderRequest = {
  contributionAmount: 500,
  frequency: 'weekly',
  goalId: 'goal-1',
  goalTitle: 'Phone',
  scheduledAt: new Date('2026-10-01T09:30:00Z'),
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('migrates legacy scheduled and pending goals independently and only once', async () => {
  await AsyncStorage.setItem(
    'baci:savings-reminder-notification-id',
    'legacy-id'
  );
  await AsyncStorage.setItem('baci:savings-reminder-goal-id', 'goal-2');
  await AsyncStorage.setItem(
    'baci:savings-reminder-pending-request',
    JSON.stringify(pending)
  );
  expect(await savingsReminderStorage.read()).toEqual(
    expect.arrayContaining([
      { goalId: 'goal-2', notificationId: 'legacy-id', pending: undefined },
      { goalId: 'goal-1', notificationId: undefined, pending },
    ])
  );
  expect(
    await AsyncStorage.getItem('baci:savings-reminder-pending-request')
  ).toBeNull();
  expect(
    await AsyncStorage.getItem('baci:savings-reminder-notification-id')
  ).toBeNull();
  expect(
    await AsyncStorage.getItem('baci:savings-reminder-goal-id')
  ).toBeNull();
  expect(await savingsReminderStorage.read()).toHaveLength(2);
});

it('does not overwrite a newer per-goal pending request during legacy migration', async () => {
  const newer = { ...pending, contributionAmount: 900 };
  await savingsReminderStorage.write({
    goalId: pending.goalId,
    pending: newer,
  });
  await AsyncStorage.setItem(
    'baci:savings-reminder-pending-request',
    JSON.stringify(pending)
  );
  expect(await savingsReminderStorage.read('goal-1')).toEqual([
    { goalId: 'goal-1', pending: newer, notificationId: undefined },
  ]);
});

it('encodes goal keys and removes only the requested goal', async () => {
  await savingsReminderStorage.write({
    goalId: 'a:/b',
    notificationId: 'first',
  });
  await savingsReminderStorage.write({
    goalId: 'second',
    pending: { ...pending, goalId: 'second' },
  });
  expect(await savingsReminderStorage.read()).toHaveLength(2);
  await savingsReminderStorage.remove('a:/b');
  expect(await savingsReminderStorage.read()).toEqual([
    {
      goalId: 'second',
      pending: { ...pending, goalId: 'second' },
      notificationId: undefined,
    },
  ]);
});

it.each([
  'null',
  '{}',
  '{bad json',
  JSON.stringify({ ...pending, scheduledAt: 'invalid' }),
  JSON.stringify({ ...pending, frequency: 'yearly' }),
])('ignores malformed legacy pending data %s', async (value) => {
  await AsyncStorage.setItem('baci:savings-reminder-pending-request', value);
  expect(await savingsReminderStorage.read()).toEqual([]);
  expect(
    await AsyncStorage.getItem('baci:savings-reminder-pending-request')
  ).toBeNull();
});

it('rejects pending records whose goal does not match their key', async () => {
  await AsyncStorage.setItem(
    'baci:savings-reminder-goal:other',
    JSON.stringify({ pending })
  );
  expect(await savingsReminderStorage.read('other')).toEqual([
    { goalId: 'other', pending: undefined, notificationId: undefined },
  ]);
});

it('retains an orphaned legacy notification for cancel-all without assigning it to a goal', async () => {
  await AsyncStorage.setItem('baci:savings-reminder-notification-id', 'orphan');
  expect(await savingsReminderStorage.read('goal-1')).toEqual([
    { goalId: 'goal-1' },
  ]);
  expect(await savingsReminderStorage.read()).toEqual([
    { goalId: '', notificationId: 'orphan' },
  ]);
  await savingsReminderStorage.remove('');
  expect(await savingsReminderStorage.read()).toEqual([]);
});

it('continues serialized operations after a failure', async () => {
  const failure = savingsReminderStorage.runExclusive(async () => {
    throw new Error('failed');
  });
  const success = savingsReminderStorage.runExclusive(async () => 'next');
  await expect(failure).rejects.toThrow('failed');
  await expect(success).resolves.toBe('next');
});
