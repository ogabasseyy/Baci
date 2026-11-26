// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const f = vi.hoisted(() => ({
  host: vi.fn(),
  listener: vi.fn(),
  owner: vi.fn(),
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
vi.mock('../../../builder-mcp-server/owner-internal-node', () => ({
  createOwnerInternalNodeServer: f.owner,
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

f.owner.mockImplementation(() => ({
  listen: vi.fn(async () => 8793),
  close: vi.fn(async () => {}),
}));

it.each([
  false,
  true,
])('installs a fixed verifier relay and exposes full-code tools only with the worker (%s)', async (backgroundBuilds) => {
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
    integration: {
      executionOrigin: 'https://output.runtime.test',
      runner: { key: new Uint8Array(32).fill(5) },
      build: { key: new Uint8Array(32).fill(6) },
    },
  } as never;
  const stack = await startProductionBuilderStack({
    host,
    port: 8790,
    deliveryPort: 8791,
    ownerPort: 8793,
    verifierPort: 8792,
    verifierKey: new Uint8Array(32).fill(7),
    ...(backgroundBuilds && { backgroundWorker: { schedule: () => () => {} } }),
  });
  try {
    expect(f.listener).toHaveBeenLastCalledWith({ keys: [] }, backgroundBuilds);
    expect(f.owner).toHaveBeenLastCalledWith({
      ownerPreview: undefined,
      ownerAttestation: expect.any(Function),
      ownerPublicVerification: expect.any(Function),
      ownerAttestationAdmission: expect.any(Function),
      ownerPublicVerificationAdmission: expect.any(Function),
    });
  } finally {
    await stack.close();
  }
  await expect(
    startProductionBuilderStack({
      host,
      port: 8790,
      deliveryPort: 8791,
      ownerPort: 8793,
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
    ownerPort: 8793,
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
    expect(f.listener).toHaveBeenCalledWith({ keys: [] }, false);
    expect(f.owner).toHaveBeenCalledWith({
      ownerPreview: handler,
      ownerPreviewAdmission: expect.any(Function),
      ownerAttestation: undefined,
      ownerPublicVerification: undefined,
    });
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
      ownerPort: 8793,
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
      ownerPort: 8793,
      verifierPort: 8792,
    })
  ).rejects.toThrow('INVALID_VERIFIER_CONFIG');
  await expect(
    startProductionBuilderStack({
      host,
      port: 8790,
      deliveryPort: 8791,
      ownerPort: 8793,
      verifierPort: 8792,
      verifierKey: runnerKey,
    })
  ).rejects.toThrow('INVALID_VERIFIER_CONFIG');
  const verifierKey = new Uint8Array(32).fill(7);
  const stack = await startProductionBuilderStack({
    host,
    port: 8790,
    deliveryPort: 8791,
    ownerPort: 8793,
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

it.each([
  'owner bridge',
  'verifier',
] as const)('rejects longer transport keys containing the %s key', async (entrypoint) => {
  f.host.mockClear();
  const key = new Uint8Array(32).fill(4);
  const runnerKey = new Uint8Array(33);
  runnerKey.set(key);
  const host = {
    integration: {
      runner: { key: runnerKey },
      build: { key: new Uint8Array(32).fill(6) },
    },
  } as never;
  const base = { host, port: 8790, deliveryPort: 8791, ownerPort: 8793 };
  if (entrypoint === 'owner bridge') {
    await expect(
      startProductionBuilderStack({
        ...base,
        ownerBridge: { key, consumeNonce: vi.fn(async () => true) },
      })
    ).rejects.toThrow('INVALID_OWNER_BRIDGE_CONFIG');
  } else {
    await expect(
      startProductionBuilderStack({
        ...base,
        verifierPort: 8792,
        verifierKey: key,
      })
    ).rejects.toThrow('INVALID_VERIFIER_CONFIG');
  }
  expect(f.host).not.toHaveBeenCalled();
});
