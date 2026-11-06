import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';

const MS_PER_DAY = 86_400_000;

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
      label: `Save ${formatNgnCurrency(amountDue)} by ${formatDateTimeDisplay(maturityDate, 'date')}`,
      weeks,
    };
  }
  const amountPerWeek = Math.ceil(remaining / Math.max(1, daysRemaining / 7));
  return {
    amountPerWeek,
    label: `Save about ${formatNgnCurrency(amountPerWeek)} a week to reach this by ${formatDateTimeDisplay(maturityDate, 'date')}`,
    weeks,
  };
}
