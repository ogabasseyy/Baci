// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const f = vi.hoisted(() => ({ create: vi.fn(), install: vi.fn() }));
vi.mock('./production-builder-ports', () => ({
  createProductionBuilderPorts: f.create,
  installProductionBuilderPorts: f.install,
}));

import { startProductionBuilderHost } from './production-builder-host';

it('binds the actual broker runtime before installing ports and closes in order', async () => {
  const calls: string[] = [];
  const runtime = {
    readConnection: vi.fn(),
    resolveLinkedAccessToken: vi.fn(),
  };
  const closeBroker = vi.fn(async () => {
    calls.push('broker');
  });
  const closePorts = vi.fn(() => {
    calls.push('ports');
  });
  const deliver = vi.fn();
  f.create.mockReturnValue({});
  f.install.mockReturnValue({ close: closePorts, deliver });
  const publicBinding = {
    supabase: { url: 'https://example.test', anonKey: 'public' },
    jwks: { keys: [] },
  };
  const input = {
    integration: {} as never,
    startBroker: vi.fn(async () => ({
      runtime,
      publicBinding,
      close: closeBroker,
    })),
  };
  const host = await startProductionBuilderHost(input);
  expect(f.create).toHaveBeenCalledWith({
    signingKey: expect.any(Function),
    broker: runtime,
    supabase: publicBinding.supabase,
    integration: input.integration,
  });
  expect(host.deliver).toBe(deliver);
  await Promise.all([host.close(), host.close()]);
  expect(calls).toEqual(['ports', 'broker']);
  expect(closeBroker).toHaveBeenCalledOnce();
});

it('closes the broker if port installation fails', async () => {
  const close = vi.fn(async () => {});
  f.create.mockReturnValue({});
  f.install.mockImplementationOnce(() => {
    throw Error('install failed');
  });
  await expect(
    startProductionBuilderHost({
      integration: {} as never,
      startBroker: async () => ({
        runtime: { readConnection: vi.fn(), resolveLinkedAccessToken: vi.fn() },
        publicBinding: {
          supabase: { url: 'https://example.test', anonKey: 'public' },
          jwks: { keys: [] },
        },
        close,
      }),
    })
  ).rejects.toThrow('BUILDER_HOST_STARTUP_FAILED');
  expect(close).toHaveBeenCalledOnce();
});

it('closes the broker and redacts errors if port shutdown fails', async () => {
  const close = vi.fn(async () => {});
  f.create.mockReturnValue({});
  f.install.mockReturnValue({
    deliver: vi.fn(),
    close: () => {
      throw Error('private detail');
    },
  });
  const host = await startProductionBuilderHost({
    integration: {} as never,
    startBroker: async () => ({
      runtime: { readConnection: vi.fn(), resolveLinkedAccessToken: vi.fn() },
      publicBinding: {
        supabase: { url: 'https://example.test', anonKey: 'public' },
        jwks: { keys: [] },
      },
      close,
    }),
  });
  await expect(host.close()).rejects.toThrow('BUILDER_HOST_SHUTDOWN_FAILED');
  expect(close).toHaveBeenCalledOnce();
});
