import { formatAdminThresholdCurrencyForCode } from '@/lib/admin-currency';

function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export const settlementExceptionFormatters = {
  currency(value: unknown) {
    return isCurrencyCode(value) ? value : 'Unavailable';
  },
  genericMoney(value: unknown, row: Record<string, unknown>) {
    if (typeof value !== 'number') return '—';

    return formatAdminThresholdCurrencyForCode(
      value,
      isCurrencyCode(row.currency) ? row.currency : 'UNK'
    );
  },
  settlementMoney(value: unknown, row: Record<string, unknown>) {
    if (typeof value !== 'number' || !isCurrencyCode(row.currency)) {
      return 'Unavailable';
    }

    return formatAdminThresholdCurrencyForCode(value, row.currency);
  },
};
