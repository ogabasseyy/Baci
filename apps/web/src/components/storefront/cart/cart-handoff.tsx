'use client';

import { cartLineIdentity } from '@baci/shared/cart';

import { Button } from '@/components/ui/button';
import { describeOption, formatMinor } from './cart-handoff-support';
import { useCartHandoff } from './use-cart-handoff';
export function CartHandoff(props: { token: string; handoffId: string }) {
  const {
    preview,
    destCart,
    destChecked,
    loadError,
    previewRetryable,
    conflicts,
    setConflicts,
    resolutions,
    setResolutions,
    redeeming,
    redeemError,
    destinationError,
    setDestinationError,
    loadPreview,
    act,
    continueMerge,
  } = useCartHandoff(props);

  if (destinationError) {
    return (
      <section
        aria-label="Cart handoff"
        className="mx-auto max-w-xl px-4 py-10"
      >
        <h1 className="text-xl font-semibold">We could not check your cart</h1>
        <p role="alert" className="mt-2 text-sm">
          {destinationError}
        </p>
        <Button
          className="mt-4"
          onClick={() => {
            setDestinationError(null);
            void loadPreview();
          }}
        >
          Try again
        </Button>
      </section>
    );
  }

  if (loadError) {
    return (
      <section
        aria-label="Cart handoff"
        className="mx-auto max-w-xl px-4 py-10"
      >
        <h1 className="text-xl font-semibold">
          {previewRetryable
            ? 'We could not load this cart link'
            : 'This cart link ended'}
        </h1>
        <p role="alert" className="mt-2 text-sm">
          {loadError}
        </p>
        {previewRetryable ? (
          <Button className="mt-4" onClick={() => void loadPreview()}>
            Try again
          </Button>
        ) : null}
      </section>
    );
  }

  if (!preview || !destChecked) {
    return (
      <section
        aria-label="Cart handoff"
        className="mx-auto max-w-xl px-4 py-10"
      >
        <p className="text-sm">Loading your shared cart…</p>
      </section>
    );
  }

  if (preview.status === 'consumed') {
    return (
      <section
        aria-label="Cart handoff"
        className="mx-auto max-w-xl px-4 py-10"
      >
        <h1 className="text-xl font-semibold">This link was already used</h1>
        <p className="mt-2 text-sm">
          Ask the sender for a fresh link to continue their cart.
        </p>
      </section>
    );
  }

  if (preview.status === 'expired' || !preview.snapshot) {
    return (
      <section
        aria-label="Cart handoff"
        className="mx-auto max-w-xl px-4 py-10"
      >
        <h1 className="text-xl font-semibold">This link has expired</h1>
        <p className="mt-2 text-sm">
          Handoff links last five minutes. Ask the sender for a fresh one.
        </p>
      </section>
    );
  }

  const incoming = preview.snapshot;

  const currency = incoming.currency;

  const itemCount = incoming.lines.reduce(
    (sum, line) => sum + line.quantity,
    0
  );

  if (conflicts.length > 0) {
    return (
      <section
        aria-label="Cart handoff"
        className="mx-auto max-w-xl px-4 py-10"
      >
        <h1 className="text-xl font-semibold">Choose what to keep</h1>
        <p className="mt-2 text-sm">
          Some items differ between the carts. Choose which version to keep for
          every listed item.
        </p>
        <div className="mt-4 space-y-4">
          {conflicts.map((conflict) => {
            const key = cartLineIdentity(conflict.item);
            return (
              <fieldset key={key} className="border-t pt-3">
                <legend className="text-sm font-medium">
                  Item {conflict.item.productId.slice(0, 8)}
                </legend>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={key}
                    checked={resolutions[key] === 'incoming'}
                    onChange={() =>
                      setResolutions((current) => ({
                        ...current,
                        [key]: 'incoming',
                      }))
                    }
                  />
                  Use incoming ({describeOption(conflict.incoming, currency)})
                </label>
                <label className="mt-1 flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={key}
                    checked={resolutions[key] === 'existing'}
                    onChange={() =>
                      setResolutions((current) => ({
                        ...current,
                        [key]: 'existing',
                      }))
                    }
                  />
                  Keep existing ({describeOption(conflict.existing, currency)})
                </label>
              </fieldset>
            );
          })}
        </div>
        {redeemError ? (
          <p role="alert" className="mt-3 text-sm">
            {redeemError}
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <Button disabled={redeeming} onClick={() => void continueMerge()}>
            {redeeming ? 'Merging…' : 'Continue merge'}
          </Button>
          <Button
            variant="secondary"
            disabled={redeeming}
            onClick={() => {
              setConflicts([]);
              setResolutions({});
            }}
          >
            Back
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Cart handoff" className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-xl font-semibold">
        Continue a cart
        {preview.merchant?.slug ? ` from ${preview.merchant.slug}` : ''}
      </h1>
      <p className="mt-2 text-sm">
        {itemCount} {itemCount === 1 ? 'item' : 'items'} ·{' '}
        {formatMinor(incoming.totalMinor, currency)}
      </p>
      <ul className="mt-4 space-y-1 text-sm">
        {incoming.lines.map((line) => (
          <li key={line.id}>
            {line.quantity} × item {line.item.productId.slice(0, 8)} ·{' '}
            {formatMinor(line.lineTotalMinor, currency)}
          </li>
        ))}
      </ul>
      {redeemError ? (
        <p role="alert" className="mt-3 text-sm">
          {redeemError}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={redeeming} onClick={() => void act('connect')}>
          {redeeming ? 'Connecting…' : 'Connect this cart'}
        </Button>
        {destCart ? (
          <>
            <Button disabled={redeeming} onClick={() => void act('merge')}>
              {redeeming ? 'Merging…' : 'Merge with my cart'}
            </Button>
            <Button
              variant="secondary"
              disabled={redeeming}
              onClick={() => void act('keep_existing')}
            >
              Keep my existing cart
            </Button>
          </>
        ) : null}
      </div>
      {destCart ? (
        <p className="mt-3 text-sm">
          Your current cart ({destCart.lines.length}{' '}
          {destCart.lines.length === 1 ? 'line' : 'lines'}) stays untouched
          unless you merge.
        </p>
      ) : null}
    </section>
  );
}
