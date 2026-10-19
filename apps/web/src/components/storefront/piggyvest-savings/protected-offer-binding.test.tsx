import {
  createPiggyvestProtectedOfferController,
  createPiggyvestPurchaseController,
} from '@baci/shared/lib';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { protectedOfferFixture } from '../../../../../../packages/shared/src/lib/piggyvest-protected-offer.test-support';
import { purchaseFixture } from '../../../../../../packages/shared/src/test-fixtures/piggyvest-purchase';
import { BoundProtectedOffer } from './protected-offer-binding';
import { SavingsScreen } from './savings-screen';

it('does not gate the existing purchase confirmation flow on a protected offer display', async () => {
  const fixture = purchaseFixture();
  const client = {
    quote: vi.fn().mockResolvedValue(fixture.published),
    prepare: vi.fn().mockResolvedValue(fixture.receipt),
    status: vi.fn().mockResolvedValue(fixture.status),
  };
  const purchaseBinding = createPiggyvestPurchaseController({
    source: fixture.source,
    tenantKey: 'synthetic',
    operationId: fixture.operationId,
    client,
    isCurrent: () => true,
  });
  render(
    <SavingsScreen
      source={fixture.source}
      protectedOfferBinding={null}
      purchaseBinding={purchaseBinding}
      purchaseSelection={fixture.selection}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Get pickup purchase quote' })
  );
  await screen.findByRole('button', { name: 'Prepare purchase reservation' });
  expect(client.quote).toHaveBeenCalledOnce();
});

it('shows a genuine server-observed device-only price window without an acceptance hurdle', async () => {
  const fixture = protectedOfferFixture();
  const client = {
    publish: vi.fn().mockResolvedValue(fixture.published),
    status: vi.fn().mockResolvedValue(fixture.observation),
  };
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const binding = createPiggyvestProtectedOfferController({
    source,
    tenantKey: 'synthetic',
    offerId: fixture.receipt.offerId,
    client,
    isCurrent: () => true,
  });
  const rendered = render(
    <BoundProtectedOffer source={source} binding={binding} />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Check protected offer' })
  );
  await screen.findByText(/Server checked: active/);
  expect(screen.getByText('₦970.00')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText(/does not reserve physical stock/)).toBeTruthy();
  client.status.mockResolvedValue({
    ...fixture.observation,
    pricePromise: 'expired',
    observedAt: fixture.receipt.expiresAt,
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh protected offer' })
  );
  await screen.findByText(/Server checked: expired/);
  expect(screen.getByText(/original guarantee is not cancelled/)).toBeTruthy();
  expect(client.publish).toHaveBeenCalledOnce();
  rendered.rerender(<BoundProtectedOffer source={null} binding={binding} />);
  expect(screen.queryByText('₦970.00')).toBeNull();
});
