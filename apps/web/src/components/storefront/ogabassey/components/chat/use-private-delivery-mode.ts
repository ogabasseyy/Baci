'use client';

import { useRef, useState, type FormEvent } from 'react';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { isValidMerchantSlug } from '@/lib/validation';

export function canOfferPrivateDeliveryEstimate(input: {
  hydrated: boolean;
  hasItems: boolean;
  routingMode?: string;
  merchantSlug?: string;
  cartMerchantSlug?: string;
  country?: string;
  payoutCurrency?: string | null;
}): boolean {
  const country = input.country?.trim().toUpperCase() ?? '';
  const hasValidPathSlug = !!input.merchantSlug && isValidMerchantSlug(input.merchantSlug);
  return input.hydrated && input.hasItems &&
    !!input.merchantSlug && input.cartMerchantSlug === input.merchantSlug &&
    (input.routingMode === 'domain' || (input.routingMode === 'path' && hasValidPathSlug)) &&
    country === 'NG' &&
    resolveMerchantCurrencyConfig({
      country,
      payout_currency: input.payoutCurrency ?? null,
    }).code === 'NGN';
}

export function getChatPanelMobileHeightCap(bottomOffset: string): string {
  return `max(0px, calc(100dvh - env(safe-area-inset-bottom, 0px) - ${bottomOffset} - 5.5rem))`;
}

export function usePrivateDeliveryMode() {
  const [active, setActive] = useState(false);
  const [composerLocked, setComposerLocked] = useState(false);
  const submitRef = useRef<(() => void) | null>(null);

  return {
    active,
    start: () => setActive(true),
    close: (clearInput: () => void) => {
      clearInput();
      setActive(false);
      setComposerLocked(false);
    },
    composerLocked,
    setComposerLocked,
    submitRef,
    handleComposerSubmit: (event: FormEvent, normalSubmit: (event: FormEvent) => void) => {
      if (!active) {
        normalSubmit(event);
        return;
      }
      event.preventDefault();
      submitRef.current?.();
    },
  };
}
