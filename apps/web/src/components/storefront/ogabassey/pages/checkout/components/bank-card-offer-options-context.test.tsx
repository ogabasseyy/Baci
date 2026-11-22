import { renderHook } from '@testing-library/react';
import { useContext } from 'react';
import { expect, it } from 'vitest';
import { BankCardOfferOptionsContext } from './bank-card-offer-options-context';

it('defaults to no bank offer options outside the checkout provider', () => {
  const { result } = renderHook(() => useContext(BankCardOfferOptionsContext));
  expect(result.current).toBeNull();
});
