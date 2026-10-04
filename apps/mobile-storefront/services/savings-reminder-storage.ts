import { asyncStorage } from '@/lib/storage';

const RECORD_PREFIX = 'baci:savings-reminder-goal:';
const LEGACY_NOTIFICATION_KEY = 'baci:savings-reminder-notification-id';
const LEGACY_GOAL_KEY = 'baci:savings-reminder-goal-id';
const LEGACY_PENDING_KEY = 'baci:savings-reminder-pending-request';

export type SavingsReminderRequest = {
  contributionAmount: number;
  frequency: 'daily' | 'weekly' | 'monthly';
  goalId: string;
  goalTitle: string;
  scheduledAt: Date;
};

type ReminderRecord = {
  goalId: string;
  notificationId?: string;
  pending?: SavingsReminderRequest;
};

let operationQueue = Promise.resolve();

function runExclusive<Result>(
  operation: () => Promise<Result>
): Promise<Result> {
  const result = operationQueue.then(operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function parseJson(value: string | null): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function parseRequest(value: unknown): SavingsReminderRequest | undefined {
  if (!value || typeof value !== 'object') return;
  if (!('scheduledAt' in value) || typeof value.scheduledAt !== 'string')
    return;
  const scheduledAt = new Date(value.scheduledAt);
  if (
    !('contributionAmount' in value) ||
    typeof value.contributionAmount !== 'number' ||
    !Number.isFinite(value.contributionAmount) ||
    !('frequency' in value) ||
    (value.frequency !== 'daily' &&
      value.frequency !== 'weekly' &&
      value.frequency !== 'monthly') ||
    !('goalId' in value) ||
    typeof value.goalId !== 'string' ||
    !value.goalId ||
    !('goalTitle' in value) ||
    typeof value.goalTitle !== 'string' ||
    Number.isNaN(scheduledAt.getTime())
  )
    return;
  return {
    contributionAmount: value.contributionAmount,
    frequency: value.frequency,
    goalId: value.goalId,
    goalTitle: value.goalTitle,
    scheduledAt,
  };
}

function recordKey(goalId: string) {
  return `${RECORD_PREFIX}${encodeURIComponent(goalId)}`;
}

async function readRecord(goalId: string): Promise<ReminderRecord> {
  const value = parseJson(await asyncStorage.getItem(recordKey(goalId)));
  if (!value || typeof value !== 'object') return { goalId };
  const pending = 'pending' in value ? parseRequest(value.pending) : undefined;
  return {
    goalId,
    notificationId:
      'notificationId' in value && typeof value.notificationId === 'string'
        ? value.notificationId
        : undefined,
    pending: pending?.goalId === goalId ? pending : undefined,
  };
}

async function write(record: ReminderRecord) {
  await asyncStorage.setItem(recordKey(record.goalId), JSON.stringify(record));
}

async function migrateLegacy() {
  const [notificationId, goalId, pendingValue] = await Promise.all([
    asyncStorage.getItem(LEGACY_NOTIFICATION_KEY),
    asyncStorage.getItem(LEGACY_GOAL_KEY),
    asyncStorage.getItem(LEGACY_PENDING_KEY),
  ]);
  if (notificationId && goalId) {
    const record = await readRecord(goalId);
    if (!record.notificationId) await write({ ...record, notificationId });
    await asyncStorage.removeItem(LEGACY_NOTIFICATION_KEY);
    await asyncStorage.removeItem(LEGACY_GOAL_KEY);
  } else if (!notificationId) {
    await asyncStorage.removeItem(LEGACY_GOAL_KEY);
  }
  const pending = parseRequest(parseJson(pendingValue));
  if (pending) {
    const record = await readRecord(pending.goalId);
    if (!record.pending && !record.notificationId)
      await write({ ...record, pending });
  }
  await asyncStorage.removeItem(LEGACY_PENDING_KEY);
}

async function read(goalId?: string): Promise<ReminderRecord[]> {
  await migrateLegacy();
  if (goalId !== undefined) return [await readRecord(goalId)];
  const records: ReminderRecord[] = [];
  for (const key of await asyncStorage.getAllKeys()) {
    if (!key.startsWith(RECORD_PREFIX)) continue;
    try {
      records.push(
        await readRecord(decodeURIComponent(key.slice(RECORD_PREFIX.length)))
      );
    } catch {
      await asyncStorage.removeItem(key);
    }
  }
  const orphanId = await asyncStorage.getItem(LEGACY_NOTIFICATION_KEY);
  if (orphanId) records.push({ goalId: '', notificationId: orphanId });
  return records;
}

async function remove(goalId: string) {
  await asyncStorage.removeItem(recordKey(goalId));
  if (!goalId) await asyncStorage.removeItem(LEGACY_NOTIFICATION_KEY);
}

export const savingsReminderStorage = { read, remove, runExclusive, write };
