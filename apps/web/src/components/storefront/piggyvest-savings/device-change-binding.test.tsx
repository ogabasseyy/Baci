import { createPiggyvestDeviceChangeController } from '@baci/shared/lib';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { deviceChangeFixture } from '../../../../../../packages/shared/src/test-fixtures/piggyvest-device-change';
import { BoundDeviceChangeReview } from './device-change-binding';

it('requires exact revised terms consent and synchronously blocks incompatible confirmation', async () => {
  const fixture = deviceChangeFixture();
  const client = {
    quote: vi.fn().mockResolvedValue(fixture.published),
    confirm: vi.fn().mockResolvedValue(fixture.receipt),
    status: vi.fn().mockResolvedValue(fixture.historical),
  };
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const binding = createPiggyvestDeviceChangeController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.command.operationId,
    client,
    isCurrent: () => true,
  });
  let compatible = true;
  render(
    <BoundDeviceChangeReview
      source={source}
      binding={binding}
      selection={fixture.selection}
      isCompatible={() => compatible}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review device change' }));
  const confirm = await screen.findByRole('button', {
    name: 'Confirm device change',
  });
  expect(confirm).toBeDisabled();
  expect(screen.getByText('Synthetic changed terms')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox'));
  compatible = false;
  fireEvent.click(confirm);
  expect(client.confirm).not.toHaveBeenCalled();
  compatible = true;
  fireEvent.click(confirm);
  await screen.findByText(/Historical receipt:/);
  expect(client.confirm).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole('button', { name: 'Confirm device change' })
  ).toBeNull();
});
