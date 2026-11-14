import {
  COUNTER_NEGOTIATION_DISCOUNT_STEPS,
  isProductNegotiable,
  MAX_AUTO_NEGOTIATION_DISCOUNT_RATE,
} from '@baci/shared/lib';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { createClient } from '@/lib/supabase/client';
import type { NegotiationControllerOptions } from './negotiation-modal-options';
import {
  AI_REVIEW_MESSAGE,
  COUNTER_OFFER_REPLIES,
  computeCounterOffer,
  FINAL_PRICE_MESSAGE,
} from './negotiation-modal-pricing';
import { submitNegotiationUpload } from './negotiation-modal-upload';

import { loadNegotiationSupabaseClient } from './negotiation-supabase-client';
import { getUploadFormValidationError } from './negotiation-upload-validation';
import { useNegotiationLiveVat } from './use-negotiation-live-vat';

export type NegotiationStatus =
  | 'input'
  | 'processing'
  | 'success'
  | 'failed'
  | 'final'
  | 'upload'
  | 'submitted';

export function useNegotiationModalController({
  cart,
  condition,
  currentPrice,
  isOpen,
  itemId,
  merchantId,
  merchantSlug,
  onSuccess,
  productBrand,
  productName,
  productSlug,
  type,
  variantAttributes,
  variantId,
  variantName,
}: NegotiationControllerOptions) {
  const [offer, setOffer] = useState('');
  const [status, setStatus] = useState<NegotiationStatus>('input');
  const [message, setMessage] = useState('');
  const [attemptCount, setAttemptCount] = useState(0);
  const [counterOffer, setCounterOffer] = useState<number | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLink, setUploadLink] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const supabasePromiseRef = useRef<Promise<
    ReturnType<typeof createClient>
  > | null>(null);
  const getSupabaseClient = () => {
    if (!supabasePromiseRef.current) {
      supabasePromiseRef.current = loadNegotiationSupabaseClient().catch(
        (error) => {
          supabasePromiseRef.current = null;
          throw error;
        }
      );
    }
    return supabasePromiseRef.current;
  };
  const readLiveVat = useNegotiationLiveVat(
    isOpen,
    merchantId,
    merchantSlug,
    getSupabaseClient
  );
  const submitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(false);
  const isOpenRef = useRef(isOpen);

  const clearSubmitTimeout = () => {
    if (submitTimeoutRef.current) {
      clearTimeout(submitTimeoutRef.current);
      submitTimeoutRef.current = null;
    }
  };
  const canApplyAsyncResult = () => isMountedRef.current && isOpenRef.current;

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const identity = JSON.stringify([merchantId, merchantSlug]);
  const [prevIdentity, setPrevIdentity] = useState(identity);
  if (isOpen !== prevIsOpen || identity !== prevIdentity) {
    setPrevIsOpen(isOpen);
    setPrevIdentity(identity);
    if (isOpen) {
      setOffer('');
      setStatus('input');
      setMessage('');
      setAttemptCount(0);
      setCounterOffer(null);
      setUploadFile(null);
      setUploadLink('');
      setEmail('');
      setPhone('');
    }
  }

  useEffect(() => {
    isOpenRef.current = isOpen;
    clearSubmitTimeout();
  }, [isOpen, merchantId, merchantSlug]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearSubmitTimeout();
    };
  }, []);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!offer) return;

    const offerAmount = Number.parseFloat(offer);
    if (
      !Number.isFinite(offerAmount) ||
      offerAmount <= 0 ||
      offerAmount > currentPrice
    ) {
      setMessage(
        `Enter an offer between ₦1 and ₦${currentPrice.toLocaleString()}.`
      );
      return;
    }

    setMessage('');
    setStatus('processing');
    clearSubmitTimeout();
    submitTimeoutRef.current = setTimeout(async () => {
      submitTimeoutRef.current = null;
      if (!canApplyAsyncResult()) return;

      const discountAmount = currentPrice - offerAmount;
      if (
        discountAmount > Number.EPSILON &&
        !isProductNegotiable({ brand: productBrand, name: productName })
      ) {
        setCounterOffer(null);
        setMessage(FINAL_PRICE_MESSAGE);
        setStatus('final');
        return;
      }

      if (
        discountAmount <=
        currentPrice * MAX_AUTO_NEGOTIATION_DISCOUNT_RATE + Number.EPSILON
      ) {
        setMessage(AI_REVIEW_MESSAGE);
        setStatus('success');
        onSuccess(offerAmount);
        return;
      }

      const step = Math.min(
        attemptCount,
        COUNTER_NEGOTIATION_DISCOUNT_STEPS.length - 1
      );
      let vatRate = 0;
      if (step === COUNTER_NEGOTIATION_DISCOUNT_STEPS.length - 1) {
        try {
          const freshRate = await readLiveVat();
          if (freshRate === undefined || !canApplyAsyncResult()) return;
          vatRate = freshRate;
        } catch {
          if (!canApplyAsyncResult()) return;
          setCounterOffer(null);
          setMessage('Unable to check tax settings. Please try again.');
          setStatus('input');
          return;
        }
      }
      setCounterOffer(
        computeCounterOffer(
          currentPrice,
          COUNTER_NEGOTIATION_DISCOUNT_STEPS[step],
          vatRate
        )
      );
      setMessage(
        COUNTER_OFFER_REPLIES[
          Math.min(step, COUNTER_OFFER_REPLIES.length - 1)
        ] ?? COUNTER_OFFER_REPLIES[COUNTER_OFFER_REPLIES.length - 1]
      );
      setStatus('failed');
      setAttemptCount((count) => count + 1);
    }, 1500);
  };

  const handleUploadSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Validate before downloading the lazily-loaded Supabase client: an
    // immediately rejectable form (conflicting/missing evidence, bad link,
    // bad offer) must surface feedback instantly instead of stalling on the
    // client chunk — and a chunk-load failure must not swallow validation.
    const formError = getUploadFormValidationError({
      currentPrice,
      merchantId,
      offer,
      uploadFile,
      uploadLink,
    });
    if (formError) {
      alert(formError);
      return;
    }
    let supabase: Awaited<ReturnType<typeof getSupabaseClient>>;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      // The client chunk (or its factory) can reject on stale-chunk and
      // offline transitions — before any of submitNegotiationUpload's guarded
      // paths run. Surface feedback, drop the poisoned cached promise so a
      // retry re-imports, and leave the form in its actionable upload state.
      console.error('Failed to load Supabase client:', error);
      supabasePromiseRef.current = null;
      alert(
        'Unable to load the submission service. Check your connection and try again.'
      );
      return;
    }
    await submitNegotiationUpload({
      canApplyAsyncResult,
      cart,
      condition,
      currentPrice,
      email,
      itemId,
      merchantId,
      offer,
      phone,
      productBrand,
      productName,
      productSlug,
      setMessage,
      setStatus,
      supabase,
      type,
      uploadFile,
      uploadLink,
      variantAttributes,
      variantId,
      variantName,
    });
  };

  const handleAcceptCounter = () => {
    if (!counterOffer) return;
    setMessage(AI_REVIEW_MESSAGE);
    setStatus('success');
    onSuccess(counterOffer);
  };

  return {
    attemptCount,
    counterOffer,
    email,
    handleAcceptCounter,
    handleSubmit,
    handleUploadSubmit,
    message,
    offer,
    phone,
    setEmail,
    setMessage,
    setOffer,
    setPhone,
    setStatus,
    setUploadFile,
    setUploadLink,
    status,
    uploadFile,
    uploadLink,
  };
}
