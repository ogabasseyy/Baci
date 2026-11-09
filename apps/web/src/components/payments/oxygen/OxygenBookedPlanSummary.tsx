import { CalendarDays } from 'lucide-react';
import { toOxygenMinorUnits } from '@/lib/payments/oxygen/money';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import styles from './OxygenBookedPlanSummary.module.css';

const money = (value: number) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
const date = (value: [number, number, number]) =>
  new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(value[0], value[1] - 1, value[2])));

export function OxygenBookedPlanSummary({
  state,
}: {
  state: OxygenProviderState;
}) {
  const booking = state.booking;
  const schedule = state.schedule;
  const charges = booking?.total_charges ?? state.quotedCharges;
  if (!booking || !schedule?.length || charges == null)
    return <p role="status">Preparing your payment plan…</p>;
  const upfront =
    booking.total_upfront_payment ??
    (toOxygenMinorUnits(booking.equity_amount, 'NGN') +
      toOxygenMinorUnits(charges, 'NGN')) /
      100;
  const last = schedule.at(-1);
  return (
    <section aria-label="Plan summary" className={styles.summary}>
      <div className={styles.highlights}>
        <div className={styles.upfront}>
          <p>Pay today</p>
          <strong>{money(upfront)}</strong>
          <small>
            {money(booking.equity_amount)} down payment
            <br />+ {money(charges)} charges
          </small>
        </div>
        <div className={styles.monthly}>
          <p>First monthly repayment</p>
          <strong>{money(schedule[0].amount)}</strong>
          <small>
            {booking.loan_tenure}{' '}
            {booking.loan_tenure === 1 ? 'month' : 'months'}
            {last && last.amount !== schedule[0].amount && (
              <>
                <br />
                Final payment: {money(last.amount)}
              </>
            )}
          </small>
        </div>
      </div>
      <div className={styles.schedule}>
        <div className={styles.scheduleHeading}>
          <h4>Payment schedule</h4>
          <span>
            {schedule.length} {schedule.length === 1 ? 'payment' : 'payments'}
          </span>
        </div>
        <ol aria-label="Payment dates">
          {schedule.map((row, index) => (
            <li key={row.period}>
              <div>
                <span>
                  {index === schedule.length - 1
                    ? 'Final payment'
                    : `Payment ${row.period}`}
                </span>
                <small>
                  <CalendarDays aria-hidden="true" size={14} />
                  {date(row.dueDate)}
                </small>
              </div>
              <strong>{money(row.amount)}</strong>
            </li>
          ))}
        </ol>
      </div>
      <p className={styles.context}>
        Amount financed: {money(booking.loan_amount)} · Product total:{' '}
        {money(booking.product_amount)}
      </p>
    </section>
  );
}
