import { oxygenLoanBreakdownSchema } from '@/schemas/oxygen-loan-breakdown';
import { toOxygenMinorUnits } from './money';
import { requireValue } from './runtime-policy';
export function parseOxygenBreakdown(
  raw: unknown,
  tenure: number,
  principal: number
) {
  const response = oxygenLoanBreakdownSchema.parse(raw);
  const schedule = response.periods
    .filter(
      (row) =>
        row.period !== null &&
        row.period > 0 &&
        row.dueDate &&
        row.totalInstallmentAmountForPeriod !== null &&
        row.principalDue !== null &&
        row.interestDue !== null
    )
    .map((row) => ({
      period: 0,
      dueDate: requireValue(row.dueDate),
      amount: requireValue(row.totalInstallmentAmountForPeriod),
      principal: requireValue(row.principalDue),
      interest: requireValue(row.interestDue),
    }))
    .sort(
      (a, b) =>
        Date.UTC(a.dueDate[0], a.dueDate[1] - 1, a.dueDate[2]) -
        Date.UTC(b.dueDate[0], b.dueDate[1] - 1, b.dueDate[2])
    )
    .map((row, index) => ({ ...row, period: index + 1 }));
  if (
    response.periods.some(
      (row) =>
        row.period !== null &&
        (row.period <= 0 ||
          row.dueDate === null ||
          row.totalInstallmentAmountForPeriod === null ||
          row.principalDue === null ||
          row.interestDue === null)
    ) ||
    schedule.length !== tenure ||
    schedule.some(
      (row, index) =>
        !validDate(row.dueDate) ||
        (index > 0 &&
          row.dueDate.join('-') === schedule[index - 1].dueDate.join('-')) ||
        toOxygenMinorUnits(row.amount, 'NGN') !==
          toOxygenMinorUnits(row.principal, 'NGN') +
            toOxygenMinorUnits(row.interest, 'NGN')
    ) ||
    schedule.reduce(
      (sum, row) => sum + toOxygenMinorUnits(row.principal, 'NGN'),
      0
    ) !== toOxygenMinorUnits(principal, 'NGN')
  )
    throw new Error('Incomplete repayment schedule');
  const fees = response.periods.filter(
    (row) =>
      row.period === null &&
      row.totalInstallmentAmountForPeriod === null &&
      row.principalDue === null &&
      row.interestDue === null &&
      row.totalOriginalDueForPeriod !== undefined
  );
  if (fees.length > 1) throw new Error('Unrecognized upfront charge rows');
  return {
    schedule,
    ...(fees.length === 1
      ? { quotedCharges: fees[0].totalOriginalDueForPeriod }
      : {}),
  };
}

function validDate(value: [number, number, number]): boolean {
  const date = new Date(Date.UTC(value[0], value[1] - 1, value[2]));
  return (
    date.getUTCFullYear() === value[0] &&
    date.getUTCMonth() === value[1] - 1 &&
    date.getUTCDate() === value[2]
  );
}
