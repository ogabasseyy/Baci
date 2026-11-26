// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const f = vi.hoisted(() => ({
  host: vi.fn(),
  mcp: vi.fn(),
  owner: vi.fn(),
  delivery: vi.fn(),
  bridge: vi.fn(),
}));
vi.mock('./production-builder-host', () => ({
  startProductionBuilderHost: f.host,
}));
vi.mock('./production-builder-listener', () => ({
  createProductionBuilderListener: f.mcp,
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
  createOwnerPreviewUserClientResolver: () => vi.fn(),
}));

import { startProductionBuilderStack } from './production-builder-stack';

it('requires and uses a distinct loopback owner listener instead of adding owner routes to MCP', async () => {
  const server = () => ({
    listen: vi.fn((_port, _host, callback) => callback()),
    once: vi.fn(),
    off: vi.fn(),
  });
  const publicListener = { server: server(), close: vi.fn(async () => {}) };
  const ownerListener = {
    listen: vi.fn(async () => 8793),
    close: vi.fn(async () => {}),
  };
  f.host.mockResolvedValue({
    publicJwks: { keys: [] },
    ownerSupabase: {},
    ownerPreviewLaunch: vi.fn(),
    deliver: vi.fn(),
    close: vi.fn(async () => {}),
  });
  f.mcp.mockReturnValue(publicListener);
  f.owner.mockReturnValue(ownerListener);
  f.delivery.mockReturnValue({
    server: server(),
    close: vi.fn(async () => {}),
  });
  const ownerPreview = vi.fn();
  f.bridge.mockReturnValue(ownerPreview);
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
  await expect(
    startProductionBuilderStack({
      host,
      port: 8790,
      deliveryPort: 8791,
      ownerBridge,
    })
  ).rejects.toThrow('INVALID_LISTENER_PORT');
  const stack = await startProductionBuilderStack({
    host,
    port: 8790,
    deliveryPort: 8791,
    ownerPort: 8793,
    ownerBridge,
  });
  try {
    expect(f.mcp).toHaveBeenCalledWith({ keys: [] }, false);
    expect(f.owner).toHaveBeenCalledWith({
      ownerPreview,
      ownerPreviewAdmission: expect.any(Function),
      ownerAttestation: undefined,
      ownerPublicVerification: undefined,
    });
    expect(ownerListener.listen).toHaveBeenCalledWith(8793);
  } finally {
    await stack.close();
  }
});

it('closes the public listener and host if the separate owner port cannot bind', async () => {
  const closeHost = vi.fn(async () => {});
  const closeMcp = vi.fn(async () => {});
  const closeOwner = vi.fn(async () => {});
  const server = {
    listen: vi.fn((_port, _host, callback) => callback()),
    once: vi.fn(),
    off: vi.fn(),
  };
  f.host.mockResolvedValueOnce({
    publicJwks: { keys: [] },
    ownerSupabase: {},
    ownerPreviewLaunch: vi.fn(),
    close: closeHost,
  });
  f.mcp.mockReturnValueOnce({ server, close: closeMcp });
  f.owner.mockReturnValueOnce({
    listen: vi.fn(async () => {
      throw Error('port in use');
    }),
    close: closeOwner,
  });
  f.bridge.mockReturnValueOnce(vi.fn());
  const host = {
    integration: {
      hostOrigin: 'https://builder.synthetic.test',
      runner: { key: new Uint8Array(32).fill(5) },
      build: { key: new Uint8Array(32).fill(6) },
    },
  } as never;
  await expect(
    startProductionBuilderStack({
      host,
      port: 8790,
      deliveryPort: 8791,
      ownerPort: 8793,
      ownerBridge: {
        key: new Uint8Array(32).fill(4),
        consumeNonce: vi.fn(async () => true),
      },
    })
  ).rejects.toThrow('BUILDER_STACK_STARTUP_FAILED');
  expect(closeOwner).toHaveBeenCalledOnce();
  expect(closeMcp).toHaveBeenCalledOnce();
  expect(closeHost).toHaveBeenCalledOnce();
});
