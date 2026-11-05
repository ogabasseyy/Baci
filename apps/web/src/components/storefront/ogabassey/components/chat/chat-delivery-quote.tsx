'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import { normalizeShippingQuoteResponse } from '@/lib/shipping/quote-response';
import type { ShippingQuote } from '@/types/shipping-quote';
import { parseDestinationState } from './parse-chat-destination-state';

interface ChatDeliveryQuoteProps {
  estimateUrl: string;
  cartKey: string;
  input: string;
  setInput: (value: string) => void;
  submitRef: RefObject<(() => void) | null>;
  onComposerLockChange: (locked: boolean) => void;
  onClose: () => void;
}

const GENERIC_ERROR = 'Delivery estimate unavailable. Please try again or continue to checkout.';

export function ChatDeliveryQuote({ estimateUrl, cartKey, input, setInput, submitRef, onComposerLockChange, onClose }: ChatDeliveryQuoteProps) {
  const [confirmedState, setConfirmedState] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<ShippingQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const [error, setError] = useState('');
  const [parseIssue, setParseIssue] = useState<'missing' | 'negated-state' | 'multiple-states' | 'ambiguous-niger' | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setInput('');
    setConfirmedState(null);
    setQuotes([]);
    setError('');
    setParseIssue(null);
    setLoading(false);
    setHasRequested(false);
    onComposerLockChange(false);
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [cartKey, estimateUrl, setInput]);

  function submitAddress() {
    controllerRef.current?.abort();
    requestIdRef.current += 1;
    controllerRef.current = null;
    setLoading(false);
    const result = parseDestinationState(input);
    if (result.kind !== 'matched') {
      onComposerLockChange(false);
      setParseIssue(result.kind);
      setConfirmedState(null);
      setQuotes([]);
      setError('');
      setHasRequested(false);
      return;
    }
    setParseIssue(null);
    setConfirmedState(result.stateName);
    onComposerLockChange(true);
    setHasRequested(false);
    setInput('');
    setError('');
    setQuotes([]);
  }

  useEffect(() => {
    submitRef.current = submitAddress;
    return () => { submitRef.current = null; };
  });

  async function requestEstimate() {
    if (!confirmedState || loading) return;
    controllerRef.current?.abort();
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setHasRequested(true);
    setError('');
    setInput('');
    const state = confirmedState;
    try {
      const response = await fetchWithCsrf(estimateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-baci-client': 'web-storefront' },
        signal: controller.signal,
        body: JSON.stringify({ state }),
      });
      if (!response.ok) throw new Error('Estimate request failed');
      const normalized = normalizeShippingQuoteResponse(await response.json());
      if (requestIdRef.current === requestId) setQuotes(normalized.quotes);
    } catch {
      if (requestIdRef.current === requestId && !controller.signal.aborted) {
        setError(GENERIC_ERROR);
      }
    } finally {
      if (requestIdRef.current === requestId) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }

  function reset() {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setInput('');
    setConfirmedState(null);
    setQuotes([]);
    setHasRequested(false);
    setError('');
    setParseIssue(null);
    setLoading(false);
    onComposerLockChange(false);
  }

  return (
    <section
      aria-label="Private delivery estimate"
      className="rounded-xl border border-store-border bg-store-background p-3 text-store-background-text"
      data-ph-no-autocapture=""
      data-ph-block=""
      data-session-replay-block=""
    >
      <p className="text-sm font-medium">Delivery estimate</p>
      <p className="mt-1 text-xs text-store-background-text/70">
        Share a Nigerian destination to see store-configured rates for your state. This is an estimate; checkout may show more delivery options or a different final amount.
      </p>
      <details className="mt-2 text-xs text-store-background-text/70">
        <summary className="cursor-pointer underline underline-offset-2">Privacy details</summary>
        <p className="mt-1">What you type stays in this browser and is not added to chat or sent to AI. After you confirm the recognized state, we send only that state to check this store’s rates.</p>
      </details>
      {!confirmedState ? (
        <form
          className="mt-3 space-y-2"
          aria-label="Private destination entry"
          onSubmit={(event) => { event.preventDefault(); void submitAddress(); }}
          data-ph-no-autocapture=""
          data-ph-block=""
          data-session-replay-block=""
        >
          <p className="block text-sm font-medium">Destination</p>
          <p className="text-xs text-store-background-text/70">Type your destination in the private composer below. Include the Nigerian state or FCT area.</p>
          {parseIssue === 'negated-state' ? <p role="alert" className="text-sm">A state was mentioned as excluded or not the destination. Please enter the state you want delivery to.</p> : null}
          {parseIssue === 'multiple-states' ? <p role="alert" className="text-sm">I found more than one Nigerian destination area. Please enter just the intended state or FCT.</p> : null}
          {parseIssue === 'ambiguous-niger' ? <p role="alert" className="text-sm">“Niger” could mean Niger State or the country. Please say “Niger State” if that is your destination.</p> : null}
          {parseIssue === 'missing' ? <p role="alert" className="text-sm">I couldn’t identify a Nigerian state. Please add the state or FCT area to your destination.</p> : null}
          <div className="flex gap-2">
            <button type="submit" disabled={!input.trim()} className="flex-1 rounded-lg bg-store-primary px-3 py-2 text-sm font-medium text-store-background disabled:opacity-60">Check state</button>
            <button type="button" onClick={() => { reset(); onClose(); }} className="rounded-lg border border-store-border px-3 py-2 text-sm">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm">I recognized <strong>{confirmedState}</strong> as your state. Use this state for a store-rate estimate?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void requestEstimate()} disabled={loading} className="flex-1 rounded-lg bg-store-primary px-3 py-2 text-sm font-medium text-store-background disabled:opacity-60">{loading ? 'Checking…' : 'Yes, check estimate'}</button>
            <button type="button" onClick={() => { setConfirmedState(null); setQuotes([]); setError(''); onComposerLockChange(false); }} disabled={loading} className="rounded-lg border border-store-border px-3 py-2 text-sm">Change</button>
          </div>
          {quotes.length ? (
            <div className="space-y-2" aria-label="Store rate estimates">
              {quotes.map((quote) => (
                <div key={quote.id} className="rounded-lg border border-store-border p-2 text-sm">
                  <p className="font-medium">{quote.displayName || quote.carrierName}</p>
                  <p>{new Intl.NumberFormat(undefined, { style: 'currency', currency: quote.currency }).format(quote.price)}{quote.deliveryRange || quote.estimatedDays > 0 ? ` · ${quote.deliveryRange || `${quote.estimatedDays} days`}` : ''}</p>
                  <p className="text-xs text-store-background-text/70">Store-configured state-level estimate for {confirmedState}</p>
                </div>
              ))}
            </div>
          ) : null}
          {hasRequested && !loading && !error && quotes.length === 0 ? (
            <p className="text-sm">No store-configured rate matched this state. Checkout may show other eligible delivery options.</p>
          ) : null}
          <button type="button" onClick={() => { reset(); onClose(); }} className="w-full rounded-lg border border-store-border px-3 py-2 text-sm">Close private estimate</button>
        </div>
      )}
      {error ? <p role="alert" className="mt-2 text-sm">{error}</p> : null}
      <p role="status" className="sr-only">{loading ? 'Loading delivery estimate' : ''}</p>
    </section>
  );
}
