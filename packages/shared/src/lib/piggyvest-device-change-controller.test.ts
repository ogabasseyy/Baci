import { expect, it, vi } from 'vitest';
import { deviceChangeFixture } from '../test-fixtures/piggyvest-device-change';
import { createPiggyvestDeviceChangeController } from './piggyvest-device-change-controller';

it('preserves uncertain operation and never retries after response loss or changed source', async () => {
  const fixture = deviceChangeFixture();
  const client = {
    quote: vi.fn().mockResolvedValue(fixture.published),
    confirm: vi.fn().mockRejectedValue(new Error('lost')),
    status: vi.fn().mockResolvedValue(fixture.historical),
  };
  const binding = createPiggyvestDeviceChangeController({
    source: fixture.source,
    tenantKey: 'synthetic',
    operationId: fixture.command.operationId,
    client,
    isCurrent: () => true,
  });
  await binding.quote(fixture.selection);
  await expect(binding.confirm(fixture.command)).rejects.toThrow();
  await expect(binding.confirm(fixture.command)).rejects.toThrow();
  await expect(binding.quote(fixture.selection)).rejects.toThrow();
  await binding.recover();
  expect(binding.read(fixture.source)).toMatchObject({
    status: 'uncertain',
    historical: fixture.historical,
  });
  expect(
    binding.read({
      ...fixture.source,
      policy: { ...fixture.source.policy, revisionId: fixture.command.goalId },
    })
  ).toBeNull();
  expect(client.confirm).toHaveBeenCalledOnce();
});

it('confirms once despite observer failure and preserves historical-only recovery', async () => {
  const fixture = deviceChangeFixture();
  const client = {
    quote: vi.fn().mockResolvedValue(fixture.published),
    confirm: vi.fn().mockResolvedValue(fixture.receipt),
    status: vi.fn().mockResolvedValue(fixture.historical),
  };
  const binding = createPiggyvestDeviceChangeController({
    source: fixture.source,
    tenantKey: 'synthetic',
    operationId: fixture.command.operationId,
    client,
    isCurrent: () => true,
  });
  await binding.quote(fixture.selection);
  binding.subscribe(() => {
    throw new Error('observer');
  });
  await binding.confirm(fixture.command);
  await expect(binding.confirm(fixture.command)).rejects.toThrow();
  await binding.recover();
  expect(client.confirm).toHaveBeenCalledOnce();
  expect(binding.read(fixture.source)).toMatchObject({
    status: 'confirmed',
    historical: fixture.historical,
  });
  expect(binding.getFundingBlocked()).toBe(true);
});
