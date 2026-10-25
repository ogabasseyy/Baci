import { CalendarDays } from 'lucide-react';
import { toOxygenMinorUnits } from '@/lib/payments/oxygen/money';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import styles from './OxygenComparisonSummary.module.css';
import { OxygenPaymentDates } from './OxygenPaymentDates';

const money = (value: number) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  }).format(value);
export function OxygenComparisonSummary({
  state,
  loading,
  tenure,
  heading,
}: {
  state?: OxygenProviderState;
  loading: boolean;
  tenure?: number;
  heading?: string;
}) {
  const booking = state?.booking;
  const schedule = state?.schedule;
  const charges = booking?.total_charges ?? state?.quotedCharges;
  const upfront =
    booking?.total_upfront_payment ??
    (booking && charges !== undefined
      ? (toOxygenMinorUnits(booking.equity_amount, 'NGN') +
          toOxygenMinorUnits(charges, 'NGN')) /
        100
      : undefined);
  const ready =
    !loading &&
    booking !== undefined &&
    schedule !== undefined &&
    schedule.length > 0 &&
    upfront !== undefined &&
    charges != null;
  const last = schedule?.at(-1);
  return (
    <section
      className={styles.summary}
      aria-label="Plan summary"
      aria-busy={loading}
    >
      {heading && (
        <header className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">
            Plan verification
          </p>
          <h3 className="text-lg font-bold text-gray-900">{heading}</h3>
        </header>
      )}
      <div className={styles.highlights}>
        <div>
          <p>Due upfront</p>
          <strong>
            {ready ? (
              money(upfront)
            ) : loading ? (
              <span className={styles.skeleton} aria-hidden="true" />
            ) : (
              '—'
            )}
          </strong>
          {ready && (
            <div className={styles.chips}>
              <span>
                Down payment <b>{money(booking.equity_amount)}</b>
              </span>
              <span>
                Charges <b>{money(charges)}</b>
              </span>
            </div>
          )}
        </div>
        <div>
          <p>Monthly repayment</p>
          <strong>
            {ready ? (
              money(schedule[0].amount)
            ) : loading ? (
              <span className={styles.skeleton} aria-hidden="true" />
            ) : (
              '—'
            )}
          </strong>
          <div className={styles.chips}>
            <span>{tenure ?? booking?.loan_tenure ?? '—'} months</span>
            {ready && last && last.amount !== schedule[0].amount && (
              <span>
                Final payment <b>{money(last.amount)}</b>
              </span>
            )}
          </div>
        </div>
      </div>
      {loading && (
        <p role="status" className="sr-only">
          Updating your payment plan
        </p>
      )}
      {loading && (
        <div className={styles.details}>
          <span className={styles.disabledDetails} aria-disabled="true">
            View payment dates
          </span>
        </div>
      )}
      {ready && (
        <details className={styles.details}>
          <summary>
            <span className={styles.dateToggle}>
              <CalendarDays aria-hidden="true" />
              <span>View payment dates</span>
            </span>
          </summary>
          <p className={styles.context}>
            Product total {money(booking.product_amount)} · Amount financed{' '}
            {money(booking.loan_amount)}
          </p>
          <OxygenPaymentDates schedule={schedule} />
          <p className={styles.reference}>
            Plan reference: <span>{state?.bookingReference}</span>
          </p>
        </details>
      )}
      {!loading && !ready && (
        <p className={styles.finalPayment}>
          Choose a period or tap “Show my plan” to see the confirmed figures.
        </p>
      )}
    </section>
  );
}
