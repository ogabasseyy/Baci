import { ChevronDown } from 'lucide-react';
import { equityForPercentage } from './down-payment';
import styles from './OxygenPlanForm.module.css';

const money = (value: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(
    value
  );

/** Initial selection has no provider schedule yet. Never estimate interest or installments. */
export function OxygenPlanPreview({
  productAmount,
  percentage,
  tenure,
}: {
  productAmount?: number;
  percentage: number | null;
  tenure: number;
}) {
  return (
    <section className={styles.preview} aria-label="Payment plan preview">
      <div className={styles.previewHeading}>
        <h4>Your plan at a glance</h4>
        <span>Updates as you adjust</span>
      </div>
      {productAmount !== undefined && percentage !== null ? (
        <dl className={styles.breakdown}>
          <div>
            <dt>Order amount</dt>
            <dd>{money(productAmount)}</dd>
          </div>
          <div>
            <dt>
              Down payment <span>({percentage}%)</span>
            </dt>
            <dd>{money(equityForPercentage(productAmount, percentage))}</dd>
          </div>
        </dl>
      ) : (
        <p className={styles.hint}>
          {percentage === null
            ? 'Enter a down payment between 25% and 90%.'
            : `${percentage}% down payment`}
        </p>
      )}
      <details className="group mt-4 border-t border-store-border pt-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <span className="grid gap-1 text-sm">
            <span className="text-store-text-muted">Monthly repayment</span>
            <span className="font-semibold">Not quoted yet</span>
          </span>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span>
              {tenure} {tenure === 1 ? 'month' : 'months'}
            </span>
            <ChevronDown
              aria-hidden="true"
              size={18}
              className="text-store-primary group-open:rotate-180"
            />
          </span>
        </summary>
        <p className="mt-3 text-xs leading-relaxed text-store-text-muted">
          Oxygen’s confirmed monthly repayments, charges and payment dates will
          appear after you review this plan.
        </p>
      </details>
    </section>
  );
}
