import { assertValidDate } from './assert-valid-date';

/**
 * Lagos calendar arithmetic shared by the savings-policy modules. Dates are
 * interpreted on the Africa/Lagos calendar with month-end clamping; callers
 * may pass any instant (UTC or offset) and the Lagos calendar date governs.
 * Lagos (WAT) carries no DST transitions, so a single offset probe is exact.
 */

const LAGOS_TIME_ZONE = 'Africa/Lagos';

// Single formatter for every Lagos calendar field, mirroring the
// `formatToParts` precedent in customer-savings-auto-debit-schedule.
const LAGOS_DATE_TIME_FORMAT: Intl.DateTimeFormat = new Intl.DateTimeFormat(
  'en-GB',
  {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: LAGOS_TIME_ZONE,
    year: 'numeric',
  }
);

interface LagosDateTime {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
}

function lagosDateTime(date: Date): LagosDateTime {
  assertValidDate(date, 'date');
  const values: Record<string, string> = {};
  for (const part of LAGOS_DATE_TIME_FORMAT.formatToParts(date)) {
    values[part.type] = part.value;
  }
  // Some ICU builds render midnight as "24" with hour12: false.
  const hour = Number(values.hour) % 24;
  return {
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    month: Number(values.month),
    second: Number(values.second),
    year: Number(values.year),
  };
}

/**
 * Convert Lagos wall-clock fields back to the UTC instant that displays as
 * them. Milliseconds are preserved from the source instant.
 */
function lagosWallTimeToUtc(parts: LagosDateTime, millisecond: number): Date {
  const wallAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    millisecond
  );
  const probe = lagosDateTime(new Date(wallAsUtcMs));
  const probeWallAsUtcMs = Date.UTC(
    probe.year,
    probe.month - 1,
    probe.day,
    probe.hour,
    probe.minute,
    probe.second
  );
  // Whole-second comparison: the probe drops sub-second precision.
  const offsetMs = probeWallAsUtcMs - Math.floor(wallAsUtcMs / 1000) * 1000;
  return new Date(wallAsUtcMs - offsetMs);
}

export function addCalendarMonthsClamped(date: Date, months: number): Date {
  const origin = lagosDateTime(date);
  const targetMonthIndex = origin.month - 1 + months;
  const targetYear = origin.year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(origin.day, lastDay);
  return lagosWallTimeToUtc(
    {
      day: clampedDay,
      hour: origin.hour,
      minute: origin.minute,
      month: normalizedMonth + 1,
      second: origin.second,
      year: targetYear,
    },
    date.getMilliseconds()
  );
}
