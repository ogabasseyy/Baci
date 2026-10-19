import { SnapchatAdsProviderError } from './request';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER = /^\d+$/;

export type SnapchatRecord = Record<string, unknown>;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

export function record(value: unknown): SnapchatRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as SnapchatRecord)
    : null;
}

export function objectArray(value: unknown): SnapchatRecord[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<SnapchatRecord[]>((items, item) => {
    const itemRecord = record(item);
    if (itemRecord) items.push(itemRecord);
    return items;
  }, []);
}

export function nested(value: SnapchatRecord, name: string): SnapchatRecord {
  return record(value[name]) ?? value;
}

export function integer(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isInteger(value) && value >= 0
      ? BigInt(value).toString()
      : null;
  }
  const stringValue = typeof value === 'string' ? value : null;
  return stringValue && INTEGER.test(stringValue) ? stringValue : null;
}

export function decimal(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    const stringValue = String(value);
    if (/^\d+(?:\.\d+)?$/.test(stringValue)) return stringValue;
    const expanded = value.toLocaleString('en-US', {
      maximumFractionDigits: 20,
      useGrouping: false,
    });
    return /^\d+(?:\.\d+)?$/.test(expanded) ? expanded : null;
  }
  const stringValue = typeof value === 'string' ? value : null;
  return stringValue && /^\d+(?:\.\d+)?$/.test(stringValue)
    ? stringValue
    : null;
}

export function isTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function snapchatAdsLocalDate(epoch: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).formatToParts(new Date(epoch));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function timezoneOffset(epoch: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).formatToParts(new Date(epoch));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return (
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour) % 24,
      Number(values.minute),
      Number(values.second)
    ) - epoch
  );
}

export function snapchatAdsLocalMidnight(
  date: string,
  timezone: string
): string {
  if (!ISO_DATE.test(date) || !isTimezone(timezone))
    throw new SnapchatAdsProviderError('SNAPCHAT_ADS_TIMEZONE_INVALID');
  const guess = Date.parse(`${date}T00:00:00.000Z`);
  let epoch = guess - timezoneOffset(guess, timezone);
  epoch = guess - timezoneOffset(epoch, timezone);
  return new Date(epoch).toISOString();
}

export function microToDecimal(micros: string): string {
  const amount = BigInt(micros);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function isoTimestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

export function nextSnapchatAdsDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
