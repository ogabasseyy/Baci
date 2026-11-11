// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const fixture = vi.hoisted(() => ({
  startBroker: vi.fn(),
  readConfig: vi.fn(),
  startStack: vi.fn(),
}));
vi.mock('../../tools/builder-auth/production-entry', () => ({
  launchProductionAuthFromFile: fixture.readConfig,
}));
vi.mock('../../tools/builder-auth/production-service', () => ({
  startProductionAuthBroker: fixture.startBroker,
}));
vi.mock('@/lib/experience/production-builder-stack', () => ({
  startProductionBuilderStack: fixture.startStack,
}));

import { startProductionBuilderFromPrivateConfig } from '../../tools/builder-production/boot';

it('binds the stack broker to the fixed private auth configuration', async () => {
  const stack = { close: vi.fn() };
  fixture.startStack.mockResolvedValueOnce(stack);
  const settings = {
    integration: { hostOrigin: 'https://builder.baci.test' },
    port: 10001,
    deliveryPort: 10002,
  } as never;
  expect(await startProductionBuilderFromPrivateConfig(settings)).toBe(stack);
  const input = fixture.startStack.mock.calls.at(-1)?.[0];
  expect(input.port).toBe(10001);
  expect(input.host.integration.hostOrigin).toBe('https://builder.baci.test');
  await input.host.startBroker();
  expect(fixture.readConfig).toHaveBeenCalledWith(
    '/var/lib/baci-builder-auth/auth.json',
    fixture.startBroker
  );
});

it('propagates startup failure without exposing config values', async () => {
  fixture.startStack.mockRejectedValueOnce(Error('private value'));
  await expect(
    startProductionBuilderFromPrivateConfig({} as never)
  ).rejects.toThrow('BUILDER_BOOT_FAILED');
});
