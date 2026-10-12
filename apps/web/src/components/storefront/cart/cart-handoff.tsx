'use client';

import type { CartItemIdentity, CartSnapshot } from '@baci/shared/cart';
import { cartLineIdentity } from '@baci/shared/cart';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { planCartMerge } from '@/lib/cart/merge';
import { buildCsrfHeaders } from '@/lib/csrf';

interface PreviewMerchant {
  id: string;
  slug: string | null;
}

interface PreviewResponse {
  status: 'pending' | 'consumed' | 'expired';
  merchant: PreviewMerchant | null;
  snapshot: CartSnapshot | null;
  expiresAt: string | null;
  code?: string;
}

interface ConflictOption {
  quantity?: number;
  voucherToken?: string | null;
  voucherAwardId?: string | null;
  negotiatedUnitPriceMinor?: number | null;
  negotiationStatus?: string | null;
}

interface MergeConflictView {
  item: CartItemIdentity;
  existing: ConflictOption;
  incoming: ConflictOption;
}

type Choice = 'connect' | 'merge' | 'keep_existing';

function attemptStorageKey(handoffId: string): string {
  return `baci-cart-handoff-attempt:${handoffId}`;
}

function loadOrCreateAttemptId(handoffId: string): string {
  const key = attemptStorageKey(handoffId);
  const stored = window.localStorage.getItem(key);
  if (stored) return stored;
  const attemptId =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, attemptId);
  return attemptId;
}

function formatMinor(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      currency,
      style: 'currency',
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

function describeOption(option: ConflictOption, currency: string): string {
  const parts = [`${option.quantity ?? 1} × item`];
  if (option.negotiatedUnitPriceMinor != null) {
    parts.push(
      `negotiated ${formatMinor(option.negotiatedUnitPriceMinor, currency)}`
    );
  }
  if (option.voucherToken) parts.push('with voucher');
  if (option.negotiationStatus) parts.push(option.negotiationStatus);
  return parts.join(', ');
}

function fetchJson(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { referrerPolicy: 'no-referrer', ...init });
}

export function CartHandoff(props: { token: string; handoffId: string }) {
  const { token, handoffId } = props;
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [destCart, setDestCart] = useState<CartSnapshot | null>(null);
  const [destChecked, setDestChecked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<MergeConflictView[]>([]);
  const [resolutions, setResolutions] = useState<
    Record<string, 'incoming' | 'existing'>
  >({});
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  // Strip the pairing fragment before anything else runs: fragments never
  // reach the server, and removing it keeps the secret out of history,
  // session replays and any third-party script that reads the URL.
  useLayoutEffect(() => {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search
    );
  }, []);
  const loadStarted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: this effect loads once; refresh is intentionally user-triggered thereafter.
  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    void loadPreview();
  }, []);

  async function loadDestination(slug: string | null): Promise<void> {
    const url = slug
      ? `/api/storefront/cart?merchantSlug=${encodeURIComponent(slug)}`
      : '/api/storefront/cart';
    try {
      const response = await fetchJson(url);
      if (response.status === 404) {
        setDestCart(null);
        return;
      }
      if (!response.ok) {
        setDestCart(null);
        return;
      }
      const payload = (await response.json()) as { cart?: CartSnapshot };
      setDestCart(payload.cart ?? null);
    } catch {
      setDestCart(null);
    } finally {
      setDestChecked(true);
    }
  }

  async function loadPreview(): Promise<PreviewResponse | null> {
    try {
      const response = await fetchJson(
        `/api/storefront/cart/handoff?handoff_id=${encodeURIComponent(handoffId)}`
      );
      const payload = (await response.json()) as PreviewResponse;
      if (!response.ok) {
        setLoadError(
          'This link is no longer valid. Ask the sender for a fresh one.'
        );
        return null;
      }
      setPreview(payload);
      if (payload.status === 'pending') {
        await loadDestination(payload.merchant?.slug ?? null);
      } else {
        setDestChecked(true);
      }
      return payload;
    } catch {
      setLoadError('Could not load this cart link. Check your connection.');
      return null;
    }
  }

  async function postRedeem(body: Record<string, unknown>): Promise<boolean> {
    setRedeeming(true);
    setRedeemError(null);
    try {
      const response = await fetchJson('/api/storefront/cart/handoff/redeem', {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...buildCsrfHeaders() },
        method: 'POST',
      });
      const payload = (await response.json()) as {
        code?: string;
        conflicts?: MergeConflictView[];
      };
      if (response.ok) {
        window.localStorage.removeItem(attemptStorageKey(handoffId));
        window.location.replace(
          window.location.pathname + window.location.search
        );
        return true;
      }
      if (response.status === 409 && payload.code === 'merge_conflict') {
        setConflicts(payload.conflicts ?? []);
        setResolutions({});
        return false;
      }
      if (response.status === 409 && payload.code === 'version_conflict') {
        setRedeemError(
          'One of the carts changed. Review the latest state and try again.'
        );
        await loadPreview();
        return false;
      }
      if (payload.code === 'handoff_consumed') {
        setLoadError(
          'This link was already used. Ask the sender for a fresh one.'
        );
        return false;
      }
      if (payload.code === 'expired') {
        setLoadError('This link has expired. Ask the sender for a fresh one.');
        return false;
      }
      setRedeemError('Could not continue this cart. Please try again.');
      return false;
    } catch {
      setRedeemError('Could not continue this cart. Check your connection.');
      return false;
    } finally {
      setRedeeming(false);
    }
  }

  async function act(choice: Choice): Promise<void> {
    if (!preview?.snapshot) return;
    const attemptId = loadOrCreateAttemptId(handoffId);
    const base = {
      attemptId,
      choice,
      destCartId: destCart?.cartId,
      expectedDestVersion: destCart?.version,
      expectedIncomingVersion: preview.snapshot.version,
      handoffId,
      token,
    };
    if (choice !== 'merge' || !destCart) {
      await postRedeem(base);
      return;
    }
    const resolutionList = Object.entries(resolutions).map(([key, keep]) => ({
      item: conflictItemForKey(key) ?? { productId: key },
      keep,
    }));
    const planned = planCartMerge(destCart, preview.snapshot, resolutionList);
    if (!planned.ok && planned.code === 'too_many_lines') {
      setRedeemError(
        'These carts hold too many different items to merge. Connect instead.'
      );
      return;
    }
    if (!planned.ok) {
      setConflicts(planned.conflicts);
      return;
    }
    await postRedeem({
      ...base,
      lines: planned.lines,
      resolutions: resolutionList,
    });
  }

  function conflictItemForKey(key: string): CartItemIdentity | null {
    return (
      conflicts.find((conflict) => cartLineIdentity(conflict.item) === key)
        ?.item ?? null
    );
  }

  async function continueMerge(): Promise<void> {
    if (!preview?.snapshot || !destCart) return;
    const resolutionList = conflicts
      .filter((conflict) => resolutions[cartLineIdentity(conflict.item)])
      .map((conflict) => ({
        item: conflict.item,
        keep: resolutions[cartLineIdentity(conflict.item)] as
          | 'incoming'
          | 'existing',
      }));
    if (resolutionList.length !== conflicts.length) {
      setRedeemError('Choose which version to keep for every listed item.');
      return;
    }
    // Re-plan locally so quantities follow max; the server re-enforces.
    const planned = planCartMerge(destCart, preview.snapshot, resolutionList);
    if (!planned.ok) {
      if (planned.code === 'merge_conflict') {
        setConflicts(planned.conflicts);
      } else {
        setRedeemError(
          'These carts hold too many different items to merge. Connect instead.'
        );
      }
      return;
    }
    const attemptId = loadOrCreateAttemptId(handoffId);
    const ok = await postRedeem({
      attemptId,
      choice: 'merge',
      destCartId: destCart.cartId,
      expectedDestVersion: destCart.version,
      expectedIncomingVersion: preview.snapshot.version,
      handoffId,
      lines: planned.lines,
      resolutions: resolutionList,
      token,
    });
    if (ok) {
      setConflicts([]);
    }
  }

  if (loadError) {
    return (
      <section
        aria-label="Cart handoff"
        className="mx-auto max-w-xl px-4 py-10"
      >
        <h1 className="text-xl font-semibold">This cart link ended</h1>
        <p className="mt-2 text-sm">{loadError}</p>
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
