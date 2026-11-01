'use client';

import { Check, CircleCheck, SlidersHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import { OxygenBookingActivity } from './OxygenBookingActivity';
import { OxygenDownPayment } from './OxygenDownPayment';
import { OxygenDownPaymentSlider } from './OxygenDownPaymentSlider';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import styles from './OxygenPlanForm.module.css';
import { OxygenTenurePicker } from './OxygenTenurePicker';
import type { SubmitOxygenForm } from './OxygenVerificationForms';

export function OxygenPlanForm({
  busy,
  maxTenure = 12,
  productAmount,
  submit,
}: {
  busy: boolean;
  maxTenure?: number;
  productAmount?: number;
  submit: SubmitOxygenForm;
}) {
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const bookingLock = useRef(false);
  const [equity, setEquity] = useState('25');
  const [tenure, setTenure] = useState(Math.min(3, maxTenure));
  const percentage = Number(equity);
  const valid = equity !== '' && percentage >= 25 && percentage <= 90;
  if (booking) return <OxygenBookingActivity />;
  return (
    <form
      className={styles.form}
      aria-label="Choose payment plan"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || bookingLock.current || !valid || tenure > maxTenure) return;
        bookingLock.current = true;
        setBookingError('');
        setBooking(true);
        try {
          await submit({
            action: 'book',
            equityPercentage: percentage,
            tenure,
          });
        } catch {
          setBookingError(
            'We could not confirm the booking. Check your saved progress before trying again.'
          );
        } finally {
          bookingLock.current = false;
          setBooking(false);
        }
      }}
    >
      {bookingError && (
        <p role="alert" className="text-sm text-store-primary">
          {bookingError}
        </p>
      )}
      <header className={styles.heading}>
        <span className={styles.eyebrow}>
          <SlidersHorizontal size={15} aria-hidden="true" /> Your plan, your
          choice
        </span>
        <h3>Choose your down payment</h3>
        <p>Choose your down payment and repayment period.</p>
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <CircleCheck
            size={18}
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          />
          <span>
            You’re eligible to spread your payment for up to{' '}
            <strong>
              {maxTenure} {maxTenure === 1 ? 'month' : 'months'}
            </strong>
            .
          </span>
        </div>
      </header>
      <fieldset disabled={busy} className={styles.controls}>
        {productAmount !== undefined ? (
          <OxygenDownPayment
            productAmount={productAmount}
            percentage={valid ? percentage : null}
            onChange={(value) => setEquity(value === null ? '' : String(value))}
          />
        ) : (
          <section className={styles.card} aria-label="Down payment options">
            <div className={styles.cardHeading}>
              <label htmlFor="oxygen-equity">Down payment (%)</label>
              <div className={styles.percentInput}>
                <input
                  id="oxygen-equity"
                  name="equity"
                  type="number"
                  inputMode="decimal"
                  min="25"
                  max="90"
                  step="0.01"
                  value={equity}
                  required
                  onChange={(event) => setEquity(event.target.value)}
                />
                <span aria-hidden="true">%</span>
              </div>
            </div>
            <p className={styles.hint}>
              Drag to adjust, tap a choice, or type a percentage.
            </p>
            <OxygenDownPaymentSlider
              value={valid ? percentage : 25}
              onChange={(value) => setEquity(String(value))}
            />
            <div className={styles.bounds}>
              <span>0%</span>
              <span>100%</span>
            </div>
            <div className={styles.quickChoices}>
              {Array.from({ length: 14 }, (_, index) => 25 + index * 5).map(
                (value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={percentage === value}
                    onClick={() => setEquity(String(value))}
                  >
                    {value}%
                    {percentage === value && (
                      <Check size={14} aria-hidden="true" />
                    )}
                  </button>
                )
              )}
            </div>
          </section>
        )}
        <OxygenTenurePicker
          months={Array.from({ length: maxTenure }, (_, i) => i + 1)}
          value={tenure}
          onChange={setTenure}
        />
        <p className="px-1 text-center text-xs leading-relaxed text-store-text-muted">
          You’ll see monthly payments, charges and payment dates next.
        </p>
        <OxygenLoadingButton
          type="submit"
          loading={busy}
          disabled={!valid}
          pendingLabel="Preparing your plan…"
        >
          See full breakdown
        </OxygenLoadingButton>
      </fieldset>
    </form>
  );
}
