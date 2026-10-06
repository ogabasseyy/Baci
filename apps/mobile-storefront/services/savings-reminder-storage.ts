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

export type SavingsReminderScope = {
  merchantId: string;
  userId: string;
};

export type ReminderRecord = {
  goalId: string;
  merchantId: string;
  userId: string;
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

function recordKey(scope: SavingsReminderScope, goalId: string) {
  return `${RECORD_PREFIX}${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.merchantId)}:${encodeURIComponent(goalId)}`;
}

function scopePrefix(scope: SavingsReminderScope) {
  return `${RECORD_PREFIX}${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.merchantId)}:`;
}

function parseScopedKey(key: string): {
  goalId: string;
  merchantId: string;
  userId: string;
} | null {
  if (!key.startsWith(RECORD_PREFIX)) return null;
  const segments = key.slice(RECORD_PREFIX.length).split(':');
  if (segments.length !== 3) return null;
  try {
    const [userId, merchantId, goalId] = segments.map(decodeURIComponent);
    if (!userId || !merchantId) return null;
    return { goalId, merchantId, userId };
  } catch {
    return null;
  }
}

async function readRecord(
  scope: SavingsReminderScope,
  goalId: string
): Promise<ReminderRecord> {
  const empty: ReminderRecord = {
    goalId,
    merchantId: scope.merchantId,
    userId: scope.userId,
  };
  const value = parseJson(await asyncStorage.getItem(recordKey(scope, goalId)));
  if (!value || typeof value !== 'object') return empty;
  // Belt and braces: the key already scopes the read, but a record whose
  // value disagrees with its key is corrupt — never surface it cross-scope.
  if (
    ('userId' in value && value.userId !== scope.userId) ||
    ('merchantId' in value && value.merchantId !== scope.merchantId)
  ) {
    return empty;
  }
  const pending = 'pending' in value ? parseRequest(value.pending) : undefined;
  return {
    goalId,
    merchantId: scope.merchantId,
    userId: scope.userId,
    notificationId:
      'notificationId' in value && typeof value.notificationId === 'string'
        ? value.notificationId
        : undefined,
    pending: pending?.goalId === goalId ? pending : undefined,
  };
}

async function write(record: ReminderRecord) {
  if (!record.userId || !record.merchantId) {
    throw new Error('Refusing to write an unscoped savings reminder record');
  }
  await asyncStorage.setItem(
    recordKey(
      { merchantId: record.merchantId, userId: record.userId },
      record.goalId
    ),
    JSON.stringify(record)
  );
}

function parseLegacyRecord(
  goalId: string,
  value: unknown
): ReminderRecord | null {
  if (!value || typeof value !== 'object') return null;
  const pending = 'pending' in value ? parseRequest(value.pending) : undefined;
  const notificationId =
    'notificationId' in value && typeof value.notificationId === 'string'
      ? value.notificationId
      : undefined;
  if (!pending && !notificationId) return null;
  return {
    goalId,
    merchantId: '',
    userId: '',
    notificationId,
    pending: pending?.goalId === goalId ? pending : undefined,
  };
}

/**
 * Destructively drains pre-scope records: per-goal keys without a scope
 * segment plus the ancient single-key format. Unscoped state is
 * untrustworthy by construction — it cannot be attributed to the current
 * account — so callers cancel any live OS notification and drop the rest
 * rather than adopt it. Returns the drained records for that cleanup.
 */
async function drainUnscoped(): Promise<ReminderRecord[]> {
  const drained: ReminderRecord[] = [];
  for (const key of await asyncStorage.getAllKeys()) {
    if (!key.startsWith(RECORD_PREFIX) || parseScopedKey(key)) continue;
    const suffix = key.slice(RECORD_PREFIX.length);
    let goalId = suffix;
    try {
      goalId = decodeURIComponent(suffix);
    } catch {
      // Fall through with the raw suffix; the record is dropped regardless.
    }
    const record = parseLegacyRecord(
      goalId,
      parseJson(await asyncStorage.getItem(key))
    );
    await asyncStorage.removeItem(key);
    if (record) drained.push(record);
  }
  const [notificationId, goalId, pendingValue] = await Promise.all([
    asyncStorage.getItem(LEGACY_NOTIFICATION_KEY),
    asyncStorage.getItem(LEGACY_GOAL_KEY),
    asyncStorage.getItem(LEGACY_PENDING_KEY),
  ]);
  await asyncStorage.removeItem(LEGACY_NOTIFICATION_KEY);
  await asyncStorage.removeItem(LEGACY_GOAL_KEY);
  await asyncStorage.removeItem(LEGACY_PENDING_KEY);
  if (notificationId && goalId) {
    drained.push({
      goalId,
      merchantId: '',
      notificationId,
      userId: '',
    });
  } else if (notificationId) {
    drained.push({
      goalId: '',
      merchantId: '',
      notificationId,
      userId: '',
    });
  }
  const pending = parseRequest(parseJson(pendingValue));
  if (pending) {
    drained.push({
      goalId: pending.goalId,
      merchantId: '',
      pending,
      userId: '',
    });
  }
  return drained;
}

async function read(
  scope: SavingsReminderScope,
  goalId?: string
): Promise<ReminderRecord[]> {
  if (goalId !== undefined) return [await readRecord(scope, goalId)];
  const prefix = scopePrefix(scope);
  const records: ReminderRecord[] = [];
  for (const key of await asyncStorage.getAllKeys()) {
    if (!key.startsWith(prefix)) continue;
    const parsed = parseScopedKey(key);
    if (!parsed) {
      await asyncStorage.removeItem(key);
      continue;
    }
    records.push(await readRecord(scope, parsed.goalId));
  }
  return records;
}

async function remove(scope: SavingsReminderScope, goalId: string) {
  await asyncStorage.removeItem(recordKey(scope, goalId));
}

export const savingsReminderStorage = {
  drainUnscoped,
  read,
  remove,
  runExclusive,
  write,
};
