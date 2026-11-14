import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NegotiationModal } from './NegotiationModal';

const mocks = vi.hoisted(() => ({ read: vi.fn(), status: 'registered' }));
vi.mock('./negotiation-live-vat', () => ({
  readNegotiationVatRate: mocks.read,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({
    merchant: {
      id: 'merchant-1',
      slug: 'shop',
      vat_registration_status: mocks.status,
      vat_rate: 7.5,
    },
  }),
}));
beforeEach(() => {
  vi.useFakeTimers();
  mocks.read.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

it.each([
  [0.075, 0, '₦980'],
  [0, 0.075, '₦981'],
])('uses live VAT %s → %s instead of stale cart VAT', async (staleRate, liveRate, expected) => {
  mocks.status = staleRate ? 'registered' : 'not_registered';
  mocks.read.mockResolvedValue(liveRate);
  render(
    <NegotiationModal
      isOpen
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      productName="Phone"
      currentPrice={1001}
      merchantId="merchant-1"
      type="single"
      vatRate={staleRate}
    />
  );
  for (let step = 0; step < 3; step++) {
    fireEvent.change(screen.getByLabelText('Your Offer (₦)'), {
      target: { value: '500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Offer' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    if (step < 2) fireEvent.click(screen.getByText('Negotiate Again'));
  }
  expect(screen.getByText(expected)).toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledTimes(1);
});
