import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MockGiftCardConfirmation } from './mock-gift-card-confirmation';

it('shows a synthetic voucher only after simulated confirmation and delivery', async () => {
  render(
    <MockGiftCardConfirmation
      quote={{
        id: 'fixture',
        cardId: '2844',
        totalKobo: 1673573,
        expiresAt: Date.now() + 60_000,
      }}
    />
  );
  expect(screen.queryByText('DEMO-GIFT-CARD')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm with test wallet' })
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check test delivery' })
  );
  expect(screen.getByText('DEMO-GIFT-CARD')).toBeInTheDocument();
});
