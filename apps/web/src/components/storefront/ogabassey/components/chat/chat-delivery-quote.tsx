'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import { getSubdivisions } from '@/lib/shipping/merchant-rates/subdivisions';
import { normalizeShippingQuoteResponse } from '@/lib/shipping/quote-response';
import type { ShippingQuote } from '@/types/shipping-quote';

interface ChatDeliveryQuoteProps {
  cartKey: string;
  input: string;
  setInput: (value: string) => void;
  submitRef: RefObject<(() => void) | null>;
  onComposerLockChange: (locked: boolean) => void;
  onClose: () => void;
}

const GENERIC_ERROR = 'Delivery estimate unavailable. Please try again or continue to checkout.';

function normalizeWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

export function parseDestinationState(value: string):
  | { kind: 'matched'; stateName: string }
  | { kind: 'missing' | 'ambiguous' } {
  const words = normalizeWords(value);
  const subdivisions = getSubdivisions('NG');
  const matches: string[] = [];
  let hasNegatedState = false;
  let ambiguousNiger = false;
  for (const subdivision of subdivisions) {
    const terms = [subdivision.name, ...(subdivision.aliases ?? [])];
    for (const term of terms) {
      const termWords = normalizeWords(term);
      for (let start = 0; start <= words.length - termWords.length; start += 1) {
        if (!termWords.every((word, offset) => words[start + offset] === word)) continue;
        const end = start + termWords.length;
        const preceding = words.slice(Math.max(0, start - 8), start).join(' ');
        const following = words.slice(end, end + 8).join(' ');
        const precedingNegation = /\b(?:not|never|avoid|except|excluding|instead|rather)\b|\b(?:don t|doesn t|isn t|wasn t)\b/.test(preceding);
        const followingNegation = /\b(?:not|never|isn t|is not|wasn t|was not|not my destination|not the destination)\b/.test(following);
        // “No. 12 Lagos Street” is an address number, not a negated state.
        const noIsStreetNumber = /\bno\.?\s*\d+\b/i.test(value.slice(0, value.toLowerCase().indexOf(term.toLowerCase())));
        const precedingNo = /\bno\s*$/.test(preceding) && !noIsStreetNumber;
        if (precedingNegation || followingNegation || precedingNo) hasNegatedState = true;
        if (subdivision.code === 'NG-NI') {
          const explicitlyQualified = words[end] === 'state' ||
            (words[start - 2] === 'state' && words[start - 1] === 'of');
          if (!explicitlyQualified) ambiguousNiger = true;
        }
        matches.push(subdivision.name);
      }
    }
  }
  const uniqueMatches = [...new Set(matches)];
  if (hasNegatedState || ambiguousNiger || uniqueMatches.length > 1) {
    return { kind: 'ambiguous' };
  }
  if (uniqueMatches.length === 0) return { kind: 'missing' };
  return { kind: 'matched', stateName: uniqueMatches[0] };
}

export function ChatDeliveryQuote({ cartKey, input, setInput, submitRef, onComposerLockChange, onClose }: ChatDeliveryQuoteProps) {
  const [confirmedState, setConfirmedState] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<ShippingQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const [error, setError] = useState('');
  const [parseIssue, setParseIssue] = useState<'ambiguous' | 'missing' | null>(null);
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
  }, [cartKey, setInput]);

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
      const response = await fetchWithCsrf('/api/chat/delivery-estimate', {
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
          {parseIssue === 'ambiguous' ? <p role="alert" className="text-sm">I couldn’t confidently identify one intended state. Your destination may mention conflicting states, negate a state, or use “Niger” without specifying Niger State. Please clarify the intended state.</p> : null}
          {parseIssue === 'missing' ? <p role="alert" className="text-sm">I couldn’t identify a Nigerian state. Please revise the destination to include its state or FCT.</p> : null}
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
