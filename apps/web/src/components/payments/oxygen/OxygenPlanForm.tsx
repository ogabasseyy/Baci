'use client';

import { CircleCheck, SlidersHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import { OxygenBookingActivity } from './OxygenBookingActivity';
import { OxygenDownPayment } from './OxygenDownPayment';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import styles from './OxygenPlanForm.module.css';
import { OxygenTenurePicker } from './OxygenTenurePicker';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { oxygenPlanLimits } from './plan-limits';

export function OxygenPlanForm({
  busy,
  maxTenure,
  productAmount,
  eligibleAmount,
  minimumAmount,
  offers,
  submit,
}: {
  busy: boolean;
  maxTenure?: number;
  productAmount?: number;
  eligibleAmount?: number;
  minimumAmount?: number;
  offers?: { tenure: number; loanAmount: number }[];
  submit: SubmitOxygenForm;
}) {
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const bookingLock = useRef(false);
  const limits = oxygenPlanLimits(productAmount, eligibleAmount, minimumAmount);
  const tenureAvailable = Number.isInteger(maxTenure) && (maxTenure ?? 0) > 0;
  const availableOffers = offers?.filter(
    (offer) => offer.tenure <= (maxTenure ?? 0)
  );
  const displayedMaxTenure = availableOffers?.length
    ? Math.max(...availableOffers.map((offer) => offer.tenure))
    : maxTenure;
  const preferred = Math.min(3, maxTenure ?? 1);
  const initialTenure =
    availableOffers?.find((item) => item.tenure === preferred)?.tenure ??
    availableOffers?.[0]?.tenure ??
    preferred;
  const initialOffer = offers?.find((item) => item.tenure === initialTenure);
  const initialLimits = oxygenPlanLimits(
    productAmount,
    initialOffer && eligibleAmount !== undefined
      ? Math.min(initialOffer.loanAmount, eligibleAmount)
      : eligibleAmount,
    minimumAmount
  );
  const [equity, setEquity] = useState(
    String(
      initialLimits.kind === 'available'
        ? initialLimits.min
        : limits.kind === 'available'
          ? limits.min
          : 25
    )
  );
  const [tenure, setTenure] = useState(initialTenure);
  const percentage = Number(equity);
  const offer = offers?.find((item) => item.tenure === tenure);
  const offerLimits = oxygenPlanLimits(
    productAmount,
    offer && eligibleAmount !== undefined
      ? Math.min(offer.loanAmount, eligibleAmount)
      : offer?.loanAmount,
    minimumAmount
  );
  const amountValid =
    limits.kind === 'available' &&
    equity !== '' &&
    percentage >= limits.min &&
    percentage <= limits.max;
  const valid =
    amountValid &&
    (offers === undefined ||
      (offerLimits.kind === 'available' &&
        percentage >= offerLimits.min &&
        percentage <= offerLimits.max));
  if (booking) return <OxygenBookingActivity />;
  if (
    limits.kind === 'unknown' ||
    !tenureAvailable ||
    productAmount === undefined ||
    maxTenure === undefined
  ) {
    return (
      <p role="status">
        We couldn’t load your payment options. Please check for an update.
      </p>
    );
  }
  if (limits.kind === 'unavailable') {
    return (
      <p role="status">
        No payment plan is available for this order with your current
        eligibility.
      </p>
    );
  }
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
              {displayedMaxTenure}{' '}
              {displayedMaxTenure === 1 ? 'month' : 'months'}
            </strong>
            .
          </span>
        </div>
      </header>
      <fieldset disabled={busy} className={styles.controls}>
        <OxygenDownPayment
          productAmount={productAmount}
          percentage={amountValid ? percentage : null}
          minPercentage={limits.min}
          maxPercentage={limits.max}
          onChange={(value) => setEquity(value === null ? '' : String(value))}
        />
        <OxygenTenurePicker
          months={
            availableOffers?.map((item) => item.tenure).sort((a, b) => a - b) ??
            Array.from({ length: maxTenure }, (_, i) => i + 1)
          }
          value={tenure}
          onChange={setTenure}
        />
        {!valid &&
          offerLimits.kind === 'available' &&
          percentage < offerLimits.min && (
            <p role="status">
              Increase your down payment to at least {offerLimits.min}% for this
              repayment period.
            </p>
          )}
        {offers && offerLimits.kind === 'unavailable' && (
          <p role="status">
            This repayment period is not available for this order.
          </p>
        )}
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
