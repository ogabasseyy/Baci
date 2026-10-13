import type { AdminReconciliationData } from '@/schemas/admin-reconciliation-rpc';

const CSV_COLUMNS = [
  'Occurred at',
  'Merchant',
  'Lane',
  'Status',
  'Amount',
  'Currency',
  'Provider',
  'Issue type',
] as const;

function escapeSpreadsheetCell(value: string): string {
  const trimmed = value.trimStart();
  return /^[=+\-@]/.test(trimmed) ? `'${value}` : value;
}

function escapeCsvCell(value: string | number): string {
  const safeValue = escapeSpreadsheetCell(String(value)).replaceAll('"', '""');
  return `"${safeValue}"`;
}

type ReconciliationItemWithMoney = AdminReconciliationData['items'][number] & {
  amount: number;
  currency: string;
};

function canExportItemMoney(
  item: AdminReconciliationData['items'][number]
): item is ReconciliationItemWithMoney {
  return (
    item.lane !== 'platform_settlement' &&
    item.lane !== 'direct_settlement' &&
    item.amount !== null &&
    item.currency !== null
  );
}

/** Exports only the safe, fixed reconciliation projection returned by the RPC. */
export function buildAdminReconciliationCsv(
  data: AdminReconciliationData
): string {
  const rows = data.items.map((item) =>
    [
      item.occurredAt,
      item.merchantName,
      item.lane,
      item.status,
      canExportItemMoney(item) ? item.amount : '',
      canExportItemMoney(item) ? item.currency : '',
      item.provider,
      item.issueType ?? '',
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [CSV_COLUMNS.map(escapeCsvCell).join(','), ...rows].join('\r\n');
}
