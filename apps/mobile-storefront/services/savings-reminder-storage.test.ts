import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type SavingsReminderRequest,
  type SavingsReminderScope,
  savingsReminderStorage,
} from './savings-reminder-storage';

jest.mock('@/lib/storage', () => {
  const storage = require('@react-native-async-storage/async-storage');
  return { asyncStorage: storage.default ?? storage };
});

const scopeA: SavingsReminderScope = {
  merchantId: 'merchant-1',
  userId: 'user-a',
};
const scopeB: SavingsReminderScope = {
  merchantId: 'merchant-1',
  userId: 'user-b',
};

const pending: SavingsReminderRequest = {
  contributionAmount: 500,
  frequency: 'weekly',
  goalId: 'goal-1',
  goalTitle: 'Phone',
  scheduledAt: new Date('2026-10-01T09:30:00Z'),
};

function scopedRecord(
  scope: SavingsReminderScope,
  overrides: Record<string, unknown> = {}
) {
  return {
    goalId: 'goal-1',
    merchantId: scope.merchantId,
    userId: scope.userId,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('isolates records by user scope', async () => {
  await savingsReminderStorage.write(
    scopedRecord(scopeA, { notificationId: 'a-1' })
  );
  await savingsReminderStorage.write(
    scopedRecord(scopeB, { goalId: 'goal-9', notificationId: 'b-9' })
  );

  expect(await savingsReminderStorage.read(scopeA)).toEqual([
    {
      goalId: 'goal-1',
      merchantId: 'merchant-1',
      notificationId: 'a-1',
      pending: undefined,
      userId: 'user-a',
    },
  ]);
  expect(await savingsReminderStorage.read(scopeB)).toEqual([
    expect.objectContaining({ goalId: 'goal-9', userId: 'user-b' }),
  ]);
  expect(await savingsReminderStorage.read(scopeA, 'goal-9')).toEqual([
    {
      goalId: 'goal-9',
      merchantId: 'merchant-1',
      userId: 'user-a',
    },
  ]);
});

it('isolates records by merchant scope for the same user', async () => {
  const otherMerchant: SavingsReminderScope = {
    merchantId: 'merchant-2',
    userId: 'user-a',
  };
  await savingsReminderStorage.write(
    scopedRecord(scopeA, { notificationId: 'm-1' })
  );

  expect(await savingsReminderStorage.read(otherMerchant)).toEqual([]);
  expect(await savingsReminderStorage.read(scopeA)).toHaveLength(1);
});

it('removes only the requested goal within the requested scope', async () => {
  await savingsReminderStorage.write(
    scopedRecord(scopeA, { notificationId: 'a-1' })
  );
  await savingsReminderStorage.write(
    scopedRecord(scopeB, { notificationId: 'b-1' })
  );

  await savingsReminderStorage.remove(scopeA, 'goal-1');

  expect(await savingsReminderStorage.read(scopeA)).toEqual([]);
  expect(await savingsReminderStorage.read(scopeB)).toHaveLength(1);
});

it('encodes scoped keys so separators in ids cannot cross scopes', async () => {
  await savingsReminderStorage.write(
    scopedRecord(scopeA, { goalId: 'a:/b', notificationId: 'first' })
  );
  await savingsReminderStorage.write(
    scopedRecord(scopeA, {
      goalId: 'second',
      pending: { ...pending, goalId: 'second' },
    })
  );

  expect(await savingsReminderStorage.read(scopeA)).toHaveLength(2);
  await savingsReminderStorage.remove(scopeA, 'a:/b');
  expect(await savingsReminderStorage.read(scopeA)).toEqual([
    {
      goalId: 'second',
      merchantId: 'merchant-1',
      notificationId: undefined,
      pending: { ...pending, goalId: 'second' },
      userId: 'user-a',
    },
  ]);
});

it('refuses to write an unscoped record', async () => {
  await expect(
    savingsReminderStorage.write({
      goalId: 'goal-1',
      merchantId: '',
      userId: '',
    })
  ).rejects.toThrow('unscoped');
});

it('treats a record whose value disagrees with its key as missing', async () => {
  await AsyncStorage.setItem(
    'baci:savings-reminder-goal:user-a:merchant-1:goal-1',
    JSON.stringify({
      goalId: 'goal-1',
      merchantId: 'merchant-1',
      notificationId: 'skewed',
      userId: 'user-B-INTRUDER',
    })
  );

  expect(await savingsReminderStorage.read(scopeA, 'goal-1')).toEqual([
    {
      goalId: 'goal-1',
      merchantId: 'merchant-1',
      notificationId: undefined,
      pending: undefined,
      userId: 'user-a',
    },
  ]);
});

it('rejects pending records whose goal does not match their key', async () => {
  await AsyncStorage.setItem(
    'baci:savings-reminder-goal:user-a:merchant-1:other',
    JSON.stringify({
      goalId: 'other',
      merchantId: 'merchant-1',
      pending,
      userId: 'user-a',
    })
  );

  expect(await savingsReminderStorage.read(scopeA, 'other')).toEqual([
    {
      goalId: 'other',
      merchantId: 'merchant-1',
      notificationId: undefined,
      pending: undefined,
      userId: 'user-a',
    },
  ]);
});

it('drains pre-scope records for disposal without adopting them', async () => {
  await AsyncStorage.setItem(
    'baci:savings-reminder-goal:goal-legacy',
    JSON.stringify({ notificationId: 'legacy-live' })
  );
  await AsyncStorage.setItem(
    'baci:savings-reminder-notification-id',
    'legacy-id'
  );
  await AsyncStorage.setItem('baci:savings-reminder-goal-id', 'goal-2');
  await AsyncStorage.setItem(
    'baci:savings-reminder-pending-request',
    JSON.stringify(pending)
  );
  await savingsReminderStorage.write(
    scopedRecord(scopeA, { notificationId: 'a-1' })
  );

  const drained = await savingsReminderStorage.drainUnscoped();

  expect(drained).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        goalId: 'goal-legacy',
        notificationId: 'legacy-live',
      }),
      expect.objectContaining({
        goalId: 'goal-2',
        notificationId: 'legacy-id',
      }),
      expect.objectContaining({ goalId: 'goal-1', pending }),
    ])
  );
  // Legacy keys are gone; the scoped record is untouched and still readable
  // only under its own scope.
  expect(await AsyncStorage.getAllKeys()).toEqual([
    'baci:savings-reminder-goal:user-a:merchant-1:goal-1',
  ]);
  expect(await savingsReminderStorage.read(scopeA)).toHaveLength(1);
  expect(await savingsReminderStorage.read(scopeB)).toEqual([]);
  expect(await savingsReminderStorage.drainUnscoped()).toEqual([]);
});

it('drains an orphaned legacy notification without assigning it to a goal', async () => {
  await AsyncStorage.setItem('baci:savings-reminder-notification-id', 'orphan');

  expect(await savingsReminderStorage.drainUnscoped()).toEqual([
    { goalId: '', merchantId: '', notificationId: 'orphan', userId: '' },
  ]);
  expect(await savingsReminderStorage.read(scopeA)).toEqual([]);
});

it.each([
  'null',
  '{}',
  '{bad json',
  JSON.stringify({ ...pending, scheduledAt: 'invalid' }),
  JSON.stringify({ ...pending, frequency: 'yearly' }),
])('ignores malformed legacy pending data %s', async (value) => {
  await AsyncStorage.setItem('baci:savings-reminder-pending-request', value);
  expect(await savingsReminderStorage.drainUnscoped()).toEqual([]);
  expect(
    await AsyncStorage.getItem('baci:savings-reminder-pending-request')
  ).toBeNull();
});

it('continues serialized operations after a failure', async () => {
  const failure = savingsReminderStorage.runExclusive(async () => {
    throw new Error('failed');
  });
  const success = savingsReminderStorage.runExclusive(async () => 'next');
  await expect(failure).rejects.toThrow('failed');
  await expect(success).resolves.toBe('next');
});
