import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import styles from './OxygenComparisonSummary.module.css';

type Schedule = NonNullable<OxygenProviderState['schedule']>;
type Row = Schedule[number];
const date = (value: Row['dueDate']) =>
  new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(value[0], value[1] - 1, value[2])));
const money = (amount: number) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  }).format(amount);
const ordinal = (day: number) =>
  `${day}${day >= 11 && day <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th')}`;

/** Group only contiguous equal payments on the same returned day of consecutive months. */
export function OxygenPaymentDates({ schedule }: { schedule: Schedule }) {
  const groups: Row[][] = [];
  for (const row of schedule) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (
      group &&
      previous &&
      row.amount === previous.amount &&
      row.period === previous.period + 1 &&
      row.dueDate[2] === previous.dueDate[2] &&
      row.dueDate[0] * 12 + row.dueDate[1] ===
        previous.dueDate[0] * 12 + previous.dueDate[1] + 1
    ) {
      group.push(row);
    } else groups.push([row]);
  }
  return (
    <ol aria-label="Payment dates" className={styles.dateGroups}>
      {groups.map((group) => {
        const first = group[0];
        const last = group[group.length - 1];
        return (
          <li key={first.period}>
            <div>
              <span className={styles.dateLabel}>
                {group.length > 1
                  ? `${group.length} payments · ${ordinal(first.dueDate[2])} of each month`
                  : first === schedule.at(-1)
                    ? 'Final payment'
                    : 'Payment'}
              </span>
              <span className={styles.dateRange}>
                {group.length > 1
                  ? `${date(first.dueDate)} – ${date(last.dueDate)}`
                  : date(first.dueDate)}
              </span>
            </div>
            <strong>
              {money(first.amount)}
              {group.length > 1 && <small>each</small>}
            </strong>
          </li>
        );
      })}
    </ol>
  );
}
