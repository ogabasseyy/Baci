import type { StartSavingsColors } from './start-savings.types';

export const SAVINGS_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

export type SavingsFrequency = (typeof SAVINGS_FREQUENCIES)[number];
export type SavingsFundingOption = 'wallet' | 'bank_transfer';

export function themedInputStyle(colors: StartSavingsColors) {
  return {
    borderColor: colors.border,
    color: colors.text,
    backgroundColor: colors.card,
  };
}

export function normalizeAmountInput(value: string) {
  return value.replace(/[^\d]/g, '');
}

export function parseAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function formatDateInput(value: string) {
  const dateCandidate = value.trim().slice(0, 10);
  return parseLocalDate(dateCandidate) ? dateCandidate : '';
}

export function getSavingsReminderScheduledAt({
  preferredDebitTime,
  startDate,
}: {
  preferredDebitTime: string;
  startDate: string;
}) {
  const [hourText, minuteText] = preferredDebitTime.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return new Date(`${startDate}T00:00:00`);
  }

  return new Date(
    `${startDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
  );
}

export function getTodayIsoDate() {
  return formatLocalDate(new Date());
}

function parseLocalDate(dateIso: string) {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isLastDayOfMonth(date: Date) {
  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0
  ).getDate();
  return date.getDate() === lastDay;
}

function getLastDayOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addCalendarMonths(date: Date, monthsToAdd: number) {
  const targetMonthIndex = date.getMonth() + monthsToAdd;
  const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedTargetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetMonthLastDay = getLastDayOfMonth(
    targetYear,
    normalizedTargetMonth
  );
  const targetDay = isLastDayOfMonth(date)
    ? targetMonthLastDay
    : Math.min(date.getDate(), targetMonthLastDay);

  return new Date(targetYear, normalizedTargetMonth, targetDay);
}

function addContributionCycles(
  startDateIso: string,
  frequency: SavingsFrequency,
  cyclesToAdd: number
) {
  const baseDate = parseLocalDate(startDateIso);
  if (!baseDate) {
    return null;
  }

  const targetDate = new Date(baseDate);
  switch (frequency) {
    case 'weekly':
      targetDate.setDate(baseDate.getDate() + cyclesToAdd * 7);
      break;
    case 'monthly':
      return formatLocalDate(addCalendarMonths(baseDate, cyclesToAdd));
    default:
      targetDate.setDate(baseDate.getDate() + cyclesToAdd);
      break;
  }
  return formatLocalDate(targetDate);
}

export function calculateMaturityDate({
  contributionAmount,
  frequency,
  startDate,
  targetAmount,
}: {
  contributionAmount: number;
  frequency: SavingsFrequency;
  startDate: string;
  targetAmount: number;
}) {
  const formattedStartDate = formatDateInput(startDate);
  if (!formattedStartDate) {
    return null;
  }

  if (targetAmount <= 0 || contributionAmount <= 0) {
    return null;
  }

  const cycles = Math.max(1, Math.ceil(targetAmount / contributionAmount));
  return addContributionCycles(formattedStartDate, frequency, cycles - 1);
}

export function getEffectiveInitialContribution({
  contributionAmount,
  fundingOption,
  initialContributionAmount,
  initialContributionEnabled,
}: {
  contributionAmount: number;
  fundingOption: SavingsFundingOption;
  initialContributionAmount: number;
  initialContributionEnabled: boolean;
}) {
  if (initialContributionEnabled && initialContributionAmount > 0) {
    return initialContributionAmount;
  }

  if (fundingOption === 'bank_transfer') {
    return contributionAmount;
  }

  return 0;
}

export function getRequiredTopUp({
  availableBalance,
  requiredContribution,
}: {
  availableBalance: number;
  requiredContribution: number;
}) {
  return Math.max(0, requiredContribution - Math.max(0, availableBalance));
}
