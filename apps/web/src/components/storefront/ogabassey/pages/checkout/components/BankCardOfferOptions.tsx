'use client';

import { createContext, useContext } from 'react';
import type { BrowserBankCardOffer } from '@/lib/checkout/get-browser-bank-card-offers';
import type { BankCardOfferSelection } from '../preview-bank-card-offer';

export type BankCardOfferOptionsModel = {
  options: { offer: BrowserBankCardOffer; price: BankCardOfferSelection }[];
  selectedId: string | null;
  select: (offerId: string | null) => void;
  format: (kobo: number) => string;
};

export const BankCardOfferOptionsContext =
  createContext<BankCardOfferOptionsModel | null>(null);

export function BankCardOfferOptions() {
  const model = useContext(BankCardOfferOptionsContext);
  if (!model) return null;
  return (
    <>
      {model.options.map(({ offer, price }) => (
        <button
          key={offer.id}
          type="button"
          aria-pressed={model.selectedId === offer.id}
          onClick={() => model.select(offer.id)}
          className="flex items-center justify-between gap-3 rounded-xl border border-store-background-text/15 p-3 text-left aria-pressed:border-store-primary aria-pressed:bg-store-primary/5"
        >
          <span>
            <span className="block font-semibold">
              {offer.verifiedIssuerName} card offer
            </span>
            <span className="block text-sm text-store-background-text/70">
              {offer.cardBrands
                .map(
                  (brand) =>
                    ({
                      visa: 'Visa',
                      verve: 'Verve',
                      mastercard: 'Mastercard',
                    })[brand]
                )
                .join(', ')}
              {' · Save '}
              {model.format(price.discountKobo)}
            </span>
          </span>
          <span className="shrink-0 font-semibold">
            {model.format(price.payableKobo)}
          </span>
        </button>
      ))}
      {model.selectedId &&
        !model.options.some(({ offer }) => offer.id === model.selectedId) && (
          <button
            type="button"
            className="text-left text-sm underline"
            onClick={() => model.select(null)}
          >
            This bank offer is unavailable for this checkout. Clear selection
          </button>
        )}
    </>
  );
}
