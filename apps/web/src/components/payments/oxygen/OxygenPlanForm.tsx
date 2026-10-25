'use client';

import { Check, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { toOxygenMinorUnits } from '@/lib/payments/oxygen/money';
import { OxygenDownPayment } from './OxygenDownPayment';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import styles from './OxygenPlanForm.module.css';
import { OxygenTenurePicker } from './OxygenTenurePicker';
import type { SubmitOxygenForm } from './OxygenVerificationForms';

const money = (amount: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(
    amount
  );

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
  const [equity, setEquity] = useState('25');
  const [tenure, setTenure] = useState(Math.min(3, maxTenure));
  const percentage = Number(equity);
  const valid = equity !== '' && percentage >= 25 && percentage <= 90;
  const amount =
    productAmount === undefined
      ? undefined
      : toOxygenMinorUnits(productAmount, 'NGN');
  const downPayment =
    amount === undefined || !valid
      ? undefined
      : Number(
          (BigInt(amount) * BigInt(Math.round(percentage * 100)) + 5000n) /
            10000n
        );
  return (
    <form
      className={styles.form}
      aria-label="Choose payment plan"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !valid || tenure > maxTenure) return;
        void submit({ action: 'book', equityPercentage: percentage, tenure });
      }}
    >
      <header className={styles.heading}>
        <span className={styles.eyebrow}>
          <SlidersHorizontal size={15} aria-hidden="true" /> Your plan, your
          choice
        </span>
        <h3>Choose what works for you</h3>
        <p>Adjust your down payment and choose how long to repay.</p>
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
            <input
              className={styles.slider}
              aria-label="Adjust down payment"
              type="range"
              min="25"
              max="90"
              step="0.01"
              value={valid ? percentage : 25}
              onChange={(event) => setEquity(event.target.value)}
            />
            <div className={styles.bounds}>
              <span>25% minimum</span>
              <span>90% maximum</span>
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
        <section className={styles.preview} aria-label="Payment plan preview">
          <div className={styles.previewHeading}>
            <h4>Your plan at a glance</h4>
            <span>Updates as you adjust</span>
          </div>
          {amount !== undefined && downPayment !== undefined ? (
            <dl className={styles.breakdown}>
              <div>
                <dt>Order amount</dt>
                <dd>{money(amount / 100)}</dd>
              </div>
              <div>
                <dt>
                  Down payment <span>({percentage}%)</span>
                </dt>
                <dd>{money(downPayment / 100)}</dd>
              </div>
              <div>
                <dt>Balance to finance</dt>
                <dd>{money((amount - downPayment) / 100)}</dd>
              </div>
              <div>
                <dt>Repayment period</dt>
                <dd>
                  {tenure} {tenure === 1 ? 'month' : 'months'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className={styles.hint}>
              {valid
                ? `${percentage}% down payment · ${tenure} months`
                : 'Enter a down payment between 25% and 90%.'}
            </p>
          )}
          <p className={styles.note}>
            Interest, fees and monthly repayments will appear in Oxygen’s full
            breakdown on the next step.
          </p>
        </section>
        <OxygenLoadingButton
          type="submit"
          loading={busy}
          disabled={!valid}
          pendingLabel="Preparing your plan…"
        >
          Review payment plan
        </OxygenLoadingButton>
      </fieldset>
    </form>
  );
}
