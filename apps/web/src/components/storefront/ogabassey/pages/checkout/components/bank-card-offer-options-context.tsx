'use client';

import { createContext } from 'react';
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
