import { createPiggyvestPurchaseController } from '@baci/shared/lib';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { purchaseFixture } from '../../../../../../packages/shared/src/test-fixtures/piggyvest-purchase';
import { BoundPurchaseReview } from './purchase-binding';

function setup() {
  const fixture = purchaseFixture();
  const client = {
    quote: vi.fn().mockResolvedValue(fixture.published),
    prepare: vi.fn().mockResolvedValue(fixture.receipt),
    status: vi.fn().mockResolvedValue(fixture.status),
  };
  const binding = createPiggyvestPurchaseController({
    source: fixture.source,
    tenantKey: 'synthetic',
    operationId: fixture.operationId,
    client,
    isCurrent: () => true,
  });
  return {
    ...fixture,
    source: piggyvestSavingsScreenSchema.parse(fixture.source),
    client,
    binding,
  };
}
it('requires exact customer confirmation and displays current recovery separately from history', async () => {
  const test = setup();
  render(
    <BoundPurchaseReview
      source={test.source}
      binding={test.binding}
      selection={test.selection}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Get pickup purchase quote' })
  );
  const confirm = await screen.findByRole('button', {
    name: 'Prepare purchase reservation',
  });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(confirm);
  await screen.findByText(/Historical receipt only/);
  expect(test.client.prepare).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole('button', { name: 'Prepare purchase reservation' })
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh purchase status' })
  );
  await screen.findByText(/Current internal observation: reservation retained/);
  expect(screen.getByText(/pending interest \(excluded\)/)).toBeTruthy();
});
it('rechecks live compatibility at the retained confirmation action', async () => {
  const test = setup();
  let compatible = true;
  render(
    <BoundPurchaseReview
      source={test.source}
      binding={test.binding}
      selection={test.selection}
      isCompatible={() => compatible}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Get pickup purchase quote' })
  );
  const confirm = await screen.findByRole('button', {
    name: 'Prepare purchase reservation',
  });
  fireEvent.click(screen.getByRole('checkbox'));
  compatible = false;
  fireEvent.click(confirm);
  expect(test.client.prepare).not.toHaveBeenCalled();
});
it('invalidates confirmation when the pickup selection changes', async () => {
  const test = setup();
  const mounted = render(
    <BoundPurchaseReview
      source={test.source}
      binding={test.binding}
      selection={test.selection}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Get pickup purchase quote' })
  );
  await screen.findByRole('checkbox');
  fireEvent.click(screen.getByRole('checkbox'));
  mounted.rerender(
    <BoundPurchaseReview
      source={test.source}
      binding={test.binding}
      selection={{ ...test.selection, savingsKobo: 1 }}
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Prepare purchase reservation' })
    ).toBeDisabled()
  );
  expect(test.client.prepare).not.toHaveBeenCalled();
});
