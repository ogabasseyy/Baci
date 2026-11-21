import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  BankCardOfferOptions,
  BankCardOfferOptionsContext,
} from './BankCardOfferOptions';

it('lets the buyer clear an unavailable selection', () => {
  const select = vi.fn();
  render(
    <BankCardOfferOptionsContext.Provider
      value={{ options: [], selectedId: 'expired', select, format: String }}
    >
      <BankCardOfferOptions />
    </BankCardOfferOptionsContext.Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
  expect(select).toHaveBeenCalledWith(null);
});
