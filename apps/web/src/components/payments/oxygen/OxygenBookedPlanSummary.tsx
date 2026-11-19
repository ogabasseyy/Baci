import { CalendarDays } from 'lucide-react';
import { toOxygenMinorUnits } from '@/lib/payments/oxygen/money';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import styles from './OxygenBookedPlanSummary.module.css';

const moneyFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const twoDecimalFormatter = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const money = (value: number) => moneyFormatter.format(value);
const date = (value: [number, number, number]) =>
  dateFormatter.format(new Date(Date.UTC(value[0], value[1] - 1, value[2])));

const toSafeMinorUnits = (amount: number): number | null => {
  if (!Number.isFinite(amount) || amount < 0) return null;
  try {
    return toOxygenMinorUnits(amount, 'NGN');
  } catch {
    return null;
  }
};

const toDisplayedMinorUnits = (amount: number): number | null => {
  if (!Number.isFinite(amount) || amount < 0) return null;
  try {
    return toOxygenMinorUnits(twoDecimalFormatter.format(amount), 'NGN');
  } catch {
    return null;
  }
};

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
  const equityMinor = toSafeMinorUnits(booking.equity_amount);
  const chargesMinor = toSafeMinorUnits(charges);
  const computedUpfront =
    equityMinor !== null && chargesMinor !== null
      ? (equityMinor + chargesMinor) / 100
      : booking.equity_amount + charges;
  const upfront = booking.total_upfront_payment ?? computedUpfront;
  const displayedEquityMinor = toDisplayedMinorUnits(booking.equity_amount);
  const displayedChargesMinor = toDisplayedMinorUnits(charges);
  const displayedUpfrontMinor = toDisplayedMinorUnits(upfront);
  const displayedComponentsMatchTotal =
    displayedEquityMinor !== null &&
    displayedChargesMinor !== null &&
    displayedUpfrontMinor !== null
      ? displayedEquityMinor + displayedChargesMinor === displayedUpfrontMinor
      : Math.abs(upfront - computedUpfront) < 0.005;
  const showsItemizedUpfront =
    displayedComponentsMatchTotal &&
    (booking.total_upfront_payment == null ||
      Math.abs(upfront - computedUpfront) < 0.005);
  const singleRepayment = booking.loan_tenure === 1 || schedule.length === 1;
  const last = schedule.at(-1);
  return (
    <section aria-label="Plan summary" className={styles.summary}>
      <div className={styles.highlights}>
        <div className={styles.upfront}>
          <p>Pay today</p>
          <strong>{money(upfront)}</strong>
          {showsItemizedUpfront ? (
            <small>
              {money(booking.equity_amount)} down payment
              <br />+ {money(charges)} charges
            </small>
          ) : (
            <small>Confirmed provider upfront total</small>
          )}
        </div>
        <div className={styles.monthly}>
          <p>
            {singleRepayment ? 'Monthly repayment' : 'First monthly repayment'}
          </p>
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
      {state.bookingReference && (
        <p className={styles.context}>
          Plan reference: <span>{state.bookingReference}</span>
        </p>
      )}
    </section>
  );
}
