import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';

const MS_PER_DAY = 86_400_000;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "2026-12-29" -> "29 Dec 2026", for tight layouts. */
function shortDate(day: string): string {
  const [year, month, date] = day.split('-');
  return `${Number(date)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** Computes a weekly savings pace using the goal's own maturity date. */
export function getWeeklySavingsNudge({
  maturityDate,
  now = new Date(),
  remaining,
}: {
  maturityDate: string | null | undefined;
  now?: Date;
  remaining: number;
}) {
  if (!maturityDate || !Number.isFinite(remaining) || remaining <= 0) {
    return null;
  }
  const endDay = /^\d{4}-\d{2}-\d{2}/.exec(maturityDate)?.[0];
  const todayDay = /^\d{4}-\d{2}-\d{2}/.exec(now.toISOString())?.[0];
  if (!endDay || !todayDay) return null;
  const end = Date.parse(`${endDay}T00:00:00Z`);
  const today = Date.parse(`${todayDay}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(today) || end <= today) return null;
  const daysRemaining = (end - today) / MS_PER_DAY;
  const weeks = Math.max(1, Math.ceil(daysRemaining / 7));
  if (daysRemaining < 7) {
    const amountDue = Math.ceil(remaining);
    return {
      amountPerWeek: amountDue,
      due: true,
      endsOn: shortDate(endDay),
      label: `${formatNgnCurrency(amountDue)} due by ${formatDateTimeDisplay(maturityDate, 'date')}`,
      weeks,
    };
  }
  const amountPerWeek = Math.ceil(remaining / Math.max(1, daysRemaining / 7));
  return {
    amountPerWeek,
    due: false,
    endsOn: shortDate(endDay),
    label: `${formatNgnCurrency(amountPerWeek)} a week to finish by ${formatDateTimeDisplay(maturityDate, 'date')}`,
    weeks,
  };
}
