import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  launch: vi.fn(),
  stack: vi.fn(),
  bridge: vi.fn(),
  bridgeClose: vi.fn(async () => {}),
}));
vi.mock('server-only', () => ({}));
vi.mock('../builder-auth/production-entry', () => ({
  launchProductionAuthFromFile: f.launch,
}));
vi.mock('@/lib/experience/production-builder-stack', () => ({
  startProductionBuilderStack: f.stack,
}));
vi.mock('./auth-loopback', () => ({ startAuthLoopback: f.bridge }));

import { startProductionBuilderFromPrivateConfig } from './boot';

it('rejects and closes an OAuth broker connected to a different Supabase project', async () => {
  f.launch.mockResolvedValueOnce({
    publicBinding: {
      supabase: {
        url: 'https://other.supabase.co',
        anonKey: 'sb_publishable_12345678',
      },
    },
    close: f.close,
  });
  f.stack.mockImplementationOnce(async (input) => input.host.startBroker());
  await expect(
    startProductionBuilderFromPrivateConfig({
      port: 43100,
      deliveryPort: 43101,
      rootDomain: 'example.com',
      expectedSupabase: {
        url: 'https://project.supabase.co',
        anonKey: 'sb_publishable_12345678',
      },
      integration: {} as never,
    })
  ).rejects.toThrow('BUILDER_BOOT_FAILED');
  expect(f.close).toHaveBeenCalledOnce();
});

it('starts the auth loopback only for a matching broker and closes both', async () => {
  f.close.mockClear();
  f.bridgeClose.mockClear();
  f.bridge.mockResolvedValueOnce({ close: f.bridgeClose });
  f.launch.mockResolvedValueOnce({
    socketPath: '/private/broker.sock',
    publicBinding: {
      supabase: { url: 'https://project.supabase.co', anonKey: 'public' },
    },
    close: f.close,
  });
  f.stack.mockImplementationOnce(async (input) => input.host.startBroker());
  const broker = await startProductionBuilderFromPrivateConfig({
    port: 43100,
    deliveryPort: 43101,
    authPort: 43102,
    rootDomain: 'example.com',
    expectedSupabase: { url: 'https://project.supabase.co', anonKey: 'public' },
    integration: {} as never,
  });
  expect(f.bridge).toHaveBeenCalledWith({
    socketPath: '/private/broker.sock',
    port: 43102,
  });
  await broker.close();
  expect(f.bridgeClose).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
});
