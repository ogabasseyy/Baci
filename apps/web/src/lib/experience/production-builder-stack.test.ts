// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const f = vi.hoisted(() => ({
  host: vi.fn(),
  listener: vi.fn(),
  delivery: vi.fn(),
  bridge: vi.fn(),
  userClient: vi.fn(),
}));
vi.mock('./production-builder-host', () => ({
  startProductionBuilderHost: f.host,
}));
vi.mock('./production-builder-listener', () => ({
  createProductionBuilderListener: f.listener,
}));
vi.mock('./production-delivery-listener', () => ({
  createProductionDeliveryListener: f.delivery,
}));
vi.mock('./owner-preview-bridge', () => ({
  createOwnerPreviewBridge: f.bridge,
}));
vi.mock('./owner-preview-user-client', () => ({
  createOwnerPreviewUserClientResolver: f.userClient,
}));

import { startProductionBuilderStack } from './production-builder-stack';

it('installs a fixed verifier relay only when a distinct trusted port is configured', async () => {
  const server = () => ({
    listen: vi.fn((_port, _host, callback) => callback()),
    once: vi.fn(),
    off: vi.fn(),
  });
  f.host.mockResolvedValue({
    publicJwks: { keys: [] },
    deliver: vi.fn(),
    close: vi.fn(async () => {}),
  });
  f.listener.mockReturnValue({
    server: server(),
    close: vi.fn(async () => {}),
  });
  f.delivery.mockReturnValue({
    server: server(),
    close: vi.fn(async () => {}),
  });
  const host = {
    integration: { executionOrigin: 'https://output.runtime.test' },
  } as never;
  const stack = await startProductionBuilderStack({
    host,
    port: 8790,
    deliveryPort: 8791,
    verifierPort: 8792,
  });
  try {
    expect(f.listener).toHaveBeenLastCalledWith(
      { keys: [] },
      undefined,
      expect.any(Function)
    );
  } finally {
    await stack.close();
  }
  await expect(
    startProductionBuilderStack({
      host,
      port: 8790,
      deliveryPort: 8791,
      verifierPort: 8790,
    })
  ).rejects.toThrow('INVALID_LISTENER_PORT');
});

it('attaches the owner bridge only when a trusted key and durable nonce store are supplied', async () => {
  const server = () => ({
    listen: vi.fn((_port, _host, callback) => callback()),
    once: vi.fn(),
    off: vi.fn(),
  });
  const handler = vi.fn();
  const resolveUserClient = vi.fn();
  const launch = vi.fn();
  const supabase = {
    url: 'https://project.supabase.co',
    anonKey: 'sb_publishable_synthetic',
  };
  f.host.mockResolvedValue({
    publicJwks: { keys: [] },
    ownerSupabase: supabase,
    ownerPreviewLaunch: launch,
    deliver: vi.fn(),
    close: vi.fn(async () => {}),
  });
  f.listener.mockReturnValue({
    server: server(),
    close: vi.fn(async () => {}),
  });
  f.delivery.mockReturnValue({
    server: server(),
    close: vi.fn(async () => {}),
  });
  f.userClient.mockReturnValue(resolveUserClient);
  f.bridge.mockReturnValue(handler);
  const host = {
    integration: {
      hostOrigin: 'https://builder.synthetic.test',
      executionOrigin: 'https://output.runtime.test',
      runner: { key: new Uint8Array(32).fill(5) },
      build: { key: new Uint8Array(32).fill(6) },
    },
  } as never;
  const ownerBridge = {
    key: new Uint8Array(32).fill(4),
    consumeNonce: vi.fn(async () => true),
  };
  const stack = await startProductionBuilderStack({
    host,
    port: 8790,
    deliveryPort: 8791,
    ownerBridge,
  });
  try {
    expect(f.userClient).toHaveBeenCalledWith(supabase);
    expect(f.bridge).toHaveBeenCalledWith({
      ...ownerBridge,
      previewOrigin: 'https://builder.synthetic.test',
      resolveUserClient,
      launch,
    });
    expect(f.listener).toHaveBeenCalledWith({ keys: [] }, handler);
  } finally {
    await stack.close();
  }
});

it('refuses an owner bridge key reused for the runner before starting the host', async () => {
  f.host.mockClear();
  const key = new Uint8Array(32).fill(4);
  const host = {
    integration: {
      runner: { key },
      build: { key: new Uint8Array(32).fill(6) },
    },
  } as never;
  await expect(
    startProductionBuilderStack({
      host,
      port: 8790,
      deliveryPort: 8791,
      ownerBridge: { key, consumeNonce: vi.fn() },
    })
  ).rejects.toThrow('INVALID_OWNER_BRIDGE_CONFIG');
  expect(f.host).not.toHaveBeenCalled();
});

it('requires a separate verifier key and passes it only to trusted host startup', async () => {
  const server = () => ({
    listen: vi.fn((_port, _host, callback) => callback()),
    once: vi.fn(),
    off: vi.fn(),
  });
  f.host.mockResolvedValue({
    publicJwks: { keys: [] },
    deliver: vi.fn(),
    close: vi.fn(async () => {}),
  });
  f.listener.mockReturnValue({
    server: server(),
    close: vi.fn(async () => {}),
  });
  f.delivery.mockReturnValue({
    server: server(),
    close: vi.fn(async () => {}),
  });
  const runnerKey = new Uint8Array(32).fill(5);
  const host = {
    integration: {
      executionOrigin: 'https://output.runtime.test',
      runner: { key: runnerKey },
      build: { key: new Uint8Array(32).fill(6) },
    },
    startBroker: vi.fn(),
  } as never;
  await expect(
    startProductionBuilderStack({
      host,
      port: 8790,
      deliveryPort: 8791,
      verifierPort: 8792,
      verifierKey: runnerKey,
    })
  ).rejects.toThrow('INVALID_VERIFIER_CONFIG');
  const verifierKey = new Uint8Array(32).fill(7);
  const stack = await startProductionBuilderStack({
    host,
    port: 8790,
    deliveryPort: 8791,
    verifierPort: 8792,
    verifierKey,
  });
  try {
    expect(f.host).toHaveBeenLastCalledWith(
      expect.objectContaining({
        buildVerifier: { key: verifierKey, port: 8792 },
      })
    );
  } finally {
    await stack.close();
  }
});

it('starts isolated output delivery alongside MCP and shuts down before the host', async () => {
  const calls: string[] = [];
  const server = () => ({
    listen: vi.fn((_port, _host, callback) => callback()),
    once: vi.fn(),
    off: vi.fn(),
  });
  const mcp = {
    server: server(),
    close: vi.fn(async () => {
      calls.push('mcp');
    }),
  };
  const output = {
    server: server(),
    close: vi.fn(async () => {
      calls.push('output');
    }),
  };
  const deliver = vi.fn();
  f.host.mockResolvedValue({
    publicJwks: { keys: [] },
    deliver,
    close: vi.fn(async () => {
      calls.push('host');
    }),
  });
  f.listener.mockReturnValue(mcp);
  f.delivery.mockReturnValue(output);
  const host = {
    integration: { executionOrigin: 'https://output.runtime.test' },
  } as never;
  const stack = await startProductionBuilderStack({
    host,
    port: 8790,
    deliveryPort: 8791,
  });
  expect(f.delivery).toHaveBeenCalledWith({
    executionOrigin: 'https://output.runtime.test',
    deliver,
  });
  expect(output.server.listen).toHaveBeenCalledWith(
    8791,
    '127.0.0.1',
    expect.any(Function)
  );
  await stack.close();
  expect(calls).toEqual(['output', 'mcp', 'host']);
});

it('starts the listener on loopback after the host, then closes listener before host', async () => {
  const calls: string[] = [];
  const jwks = { keys: [] };
  const closeHost = vi.fn(async () => {
    calls.push('host');
  });
  const closeListener = vi.fn(async () => {
    calls.push('listener');
  });
  const server = {
    listen: vi.fn((_port, _host, callback) => callback()),
    once: vi.fn(),
    off: vi.fn(),
  };
  f.host.mockResolvedValue({
    publicJwks: jwks,
    deliver: vi.fn(),
    close: closeHost,
  });
  f.listener.mockReturnValue({ server, close: closeListener });
  f.delivery.mockReturnValue({ server, close: vi.fn(async () => {}) });
  const stack = await startProductionBuilderStack({
    host: {
      integration: { executionOrigin: 'https://output.runtime.test' },
    } as never,
    port: 8790,
    deliveryPort: 8791,
  });
  expect(f.listener).toHaveBeenCalledWith(jwks);
  expect(server.listen).toHaveBeenCalledWith(
    8790,
    '127.0.0.1',
    expect.any(Function)
  );
  await Promise.all([stack.close(), stack.close()]);
  expect(calls).toEqual(['listener', 'host']);
});

it('closes the host if listener construction fails and rejects invalid ports before startup', async () => {
  const close = vi.fn(async () => {});
  f.host.mockClear().mockResolvedValue({ publicJwks: { keys: [] }, close });
  f.listener.mockImplementationOnce(() => {
    throw Error('private detail');
  });
  await expect(
    startProductionBuilderStack({
      host: {} as never,
      port: 8790,
      deliveryPort: 8791,
    })
  ).rejects.toThrow('BUILDER_STACK_STARTUP_FAILED');
  expect(close).toHaveBeenCalledOnce();
  f.host.mockClear();
  await expect(
    startProductionBuilderStack({
      host: {} as never,
      port: 0,
      deliveryPort: 8791,
    })
  ).rejects.toThrow('INVALID_LISTENER_PORT');
  expect(f.host).not.toHaveBeenCalled();
});

it('closes both components if the loopback listener cannot bind', async () => {
  const closeHost = vi.fn(async () => {});
  const closeListener = vi.fn(async () => {});
  let fail: ((error: Error) => void) | undefined;
  const server = {
    once: vi.fn((_event: string, callback: (error: Error) => void) => {
      fail = callback;
    }),
    off: vi.fn(),
    listen: vi.fn(() => {
      fail?.(Error('address in use'));
    }),
  };
  f.host.mockResolvedValue({ publicJwks: { keys: [] }, close: closeHost });
  f.listener.mockReturnValue({ server, close: closeListener });
  await expect(
    startProductionBuilderStack({
      host: {} as never,
      port: 8790,
      deliveryPort: 8791,
    })
  ).rejects.toThrow('BUILDER_STACK_STARTUP_FAILED');
  expect(closeListener).toHaveBeenCalledOnce();
  expect(closeHost).toHaveBeenCalledOnce();
});

it('closes delivery, MCP and host if the delivery listener cannot bind', async () => {
  const calls: string[] = [];
  const close = (name: string) =>
    vi.fn(async () => {
      calls.push(name);
    });
  const mcpServer = {
    once: vi.fn(),
    off: vi.fn(),
    listen: vi.fn((_port, _host, callback) => callback()),
  };
  let fail: ((error: Error) => void) | undefined;
  const deliveryServer = {
    once: vi.fn((_event, callback) => {
      fail = callback;
    }),
    off: vi.fn(),
    listen: vi.fn(() => {
      fail?.(Error('in use'));
    }),
  };
  f.host.mockResolvedValue({
    publicJwks: { keys: [] },
    deliver: vi.fn(),
    close: close('host'),
  });
  f.listener.mockReturnValue({ server: mcpServer, close: close('mcp') });
  f.delivery.mockReturnValue({
    server: deliveryServer,
    close: close('delivery'),
  });
  const host = {
    integration: { executionOrigin: 'https://output.runtime.test' },
  } as never;
  await expect(
    startProductionBuilderStack({ host, port: 8790, deliveryPort: 8791 })
  ).rejects.toThrow('BUILDER_STACK_STARTUP_FAILED');
  expect(calls).toEqual(['delivery', 'mcp', 'host']);
});
