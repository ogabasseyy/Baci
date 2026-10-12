'use client';

import { useSyncExternalStore } from 'react';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { BoundCancellationReview } from './cancellation-binding';
import { BoundDeviceChangeReview } from './device-change-binding';
import { BoundDraftClosureReview } from './draft-closure-binding';
import { BoundProtectedOffer } from './protected-offer-binding';
import { BoundPurchaseReview } from './purchase-binding';
import { PurchaseScreenJourney } from './purchase-screen-journey';
import type { SavingsScreenProps } from './savings-screen.types';
import { BoundScheduleReview } from './schedule-binding';

const noSubscription = () => () => undefined;
const blockedSnapshot = () => true;
const unblockedSnapshot = () => false;

export function SavingsScreen({
  source,
  submitPolicy,
  cancellation,
  purchaseBinding,
  protectedOfferBinding,
  purchaseSelection,
  scheduleBinding,
  deviceChangeBinding,
  deviceChangeSelection,
  draftClosureBinding,
}: SavingsScreenProps) {
  const parsed = piggyvestSavingsScreenSchema.safeParse(source);
  const view = parsed.success ? parsed.data : null;
  useSyncExternalStore(
    deviceChangeBinding?.subscribe ?? noSubscription,
    deviceChangeBinding?.getFundingBlocked ?? unblockedSnapshot,
    blockedSnapshot
  );
  useSyncExternalStore(
    draftClosureBinding?.subscribe ?? noSubscription,
    draftClosureBinding?.getFundingBlocked ?? unblockedSnapshot,
    blockedSnapshot
  );
  const deviceCompatible = () => {
    try {
      return (
        deviceChangeBinding === undefined ||
        (!!deviceChangeBinding && !deviceChangeBinding.getFundingBlocked())
      );
    } catch {
      return false;
    }
  };
  const closureCompatible = () => {
    try {
      return (
        draftClosureBinding === undefined ||
        (!!draftClosureBinding && !draftClosureBinding.getFundingBlocked())
      );
    } catch {
      return false;
    }
  };
  useSyncExternalStore(
    purchaseBinding?.subscribe ?? noSubscription,
    purchaseBinding?.getFundingBlocked ?? unblockedSnapshot,
    blockedSnapshot
  );
  useSyncExternalStore(
    scheduleBinding?.subscribe ?? noSubscription,
    scheduleBinding?.getFundingBlocked ?? unblockedSnapshot,
    blockedSnapshot
  );
  const purchaseCompatible = () => {
    try {
      return (
        purchaseBinding === undefined ||
        (!!purchaseBinding && !purchaseBinding.getFundingBlocked())
      );
    } catch {
      return false;
    }
  };
  const cancellationCompatible = () => {
    try {
      return (
        cancellation === undefined ||
        (!!cancellation && !cancellation.getFundingBlocked())
      );
    } catch {
      return false;
    }
  };
  const scheduleCompatible = () => {
    try {
      return (
        scheduleBinding === undefined ||
        (!!scheduleBinding && !scheduleBinding.getFundingBlocked())
      );
    } catch {
      return false;
    }
  };
  const observable =
    cancellation &&
    typeof cancellation.subscribe === 'function' &&
    typeof cancellation.getFundingBlocked === 'function'
      ? cancellation
      : null;
  const blocked = useSyncExternalStore(
    observable?.subscribe ?? noSubscription,
    cancellation === undefined
      ? unblockedSnapshot
      : (observable?.getFundingBlocked ?? blockedSnapshot),
    cancellation === undefined ? unblockedSnapshot : blockedSnapshot
  );
  let fundingBlocked = blocked;
  fundingBlocked ||=
    !purchaseCompatible() ||
    !scheduleCompatible() ||
    !deviceCompatible() ||
    !closureCompatible();
  if (cancellation !== undefined) {
    try {
      fundingBlocked ||= observable?.read(view)?.status !== 'review';
    } catch {
      fundingBlocked = true;
    }
  }
  return (
    <section
      aria-label="Staging savings journey"
      className="space-y-6 bg-store-background p-4 text-store-background-text"
    >
      <h2 className="text-xl font-semibold">Staging savings</h2>
      <p>
        Test environment only. Local preparation is not a paid purchase. No
        money movement or fulfilment is enabled here.
      </p>
      {cancellation !== undefined && (
        <fieldset
          disabled={
            !purchaseCompatible() ||
            !scheduleCompatible() ||
            !deviceCompatible() ||
            !closureCompatible()
          }
        >
          <legend className="sr-only">Cancellation review</legend>
          <BoundCancellationReview
            source={view}
            binding={cancellation ?? null}
            isCompatible={() =>
              purchaseCompatible() &&
              scheduleCompatible() &&
              deviceCompatible() &&
              closureCompatible()
            }
          />
        </fieldset>
      )}
      {purchaseBinding !== undefined && (
        <BoundPurchaseReview
          source={view}
          binding={purchaseBinding}
          selection={purchaseSelection}
          isCompatible={() =>
            cancellationCompatible() &&
            scheduleCompatible() &&
            deviceCompatible() &&
            closureCompatible()
          }
        />
      )}
      {protectedOfferBinding !== undefined && (
        <BoundProtectedOffer source={view} binding={protectedOfferBinding} />
      )}
      {scheduleBinding !== undefined && (
        <BoundScheduleReview
          source={view}
          binding={scheduleBinding}
          disabled={
            !purchaseCompatible() ||
            !cancellationCompatible() ||
            !deviceCompatible() ||
            !closureCompatible()
          }
          isCompatible={() =>
            purchaseCompatible() &&
            cancellationCompatible() &&
            deviceCompatible() &&
            closureCompatible()
          }
        />
      )}
      {deviceChangeBinding !== undefined && (
        <BoundDeviceChangeReview
          source={view}
          binding={deviceChangeBinding}
          selection={deviceChangeSelection}
          isCompatible={() =>
            purchaseCompatible() &&
            cancellationCompatible() &&
            scheduleCompatible() &&
            closureCompatible()
          }
        />
      )}
      {draftClosureBinding !== undefined && (
        <BoundDraftClosureReview
          source={view}
          binding={draftClosureBinding}
          isCompatible={() =>
            purchaseCompatible() &&
            cancellationCompatible() &&
            scheduleCompatible() &&
            deviceCompatible()
          }
        />
      )}
      {view?.status === 'ready' ? (
        <PurchaseScreenJourney
          key={JSON.stringify(view)}
          source={view}
          submitPolicy={submitPolicy}
          fundingBlocked={fundingBlocked}
        />
      ) : (
        <p role="status">
          {view?.status === 'loading'
            ? 'Loading staging savings…'
            : view?.status === 'unauthenticated'
              ? 'Sign in to view staging savings.'
              : 'Staging savings are unavailable.'}
        </p>
      )}
      {cancellation !== undefined && fundingBlocked && (
        <p role="status">
          Funding instructions hidden while cancellation requires
          reconciliation. This does not revoke the provider account.
        </p>
      )}
    </section>
  );
}
