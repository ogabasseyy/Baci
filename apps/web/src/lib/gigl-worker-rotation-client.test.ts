import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, primaryRpc, secondaryRpc, TokenError, RoleError } =
  vi.hoisted(() => ({
    createClient: vi.fn(),
    primaryRpc: vi.fn(),
    secondaryRpc: vi.fn(),
    TokenError: class extends Error {},
    RoleError: class extends Error {},
  }));
vi.mock('./gigl-tracking-worker-client', () => ({
  createGiglTrackingWorkerClient: createClient,
  GiglWorkerTokenError: TokenError,
  GiglWorkerTokenRoleError: RoleError,
}));

import { createRotatingGiglWorkerClient } from './gigl-worker-rotation-client';

describe('rotating GIGL worker client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createClient.mockImplementation((env: Record<string, string>) => ({
      rpc:
        env.GIGL_TRACKING_WORKER_TOKEN === 'primary'
          ? primaryRpc
          : secondaryRpc,
    }));
  });

  it('probes without claiming and selects the secondary after primary authentication rejection', async () => {
    primaryRpc.mockResolvedValue({ error: { code: 'PGRST301' }, status: 401 });
    secondaryRpc.mockResolvedValue({ error: { code: '22023' }, status: 400 });
    const result = await createRotatingGiglWorkerClient({
      GIGL_TRACKING_WORKER_TOKEN: 'primary',
      GIGL_TRACKING_WORKER_TOKEN_SECONDARY: 'secondary',
    });
    expect(result.rpc).toBe(secondaryRpc);
    expect(primaryRpc).toHaveBeenCalledWith(
      'claim_due_gigl_tracking_monitors',
      {
        p_limit: 0,
        p_worker_id: 'gigl-capability-preflight',
      }
    );
    expect(secondaryRpc).toHaveBeenCalledTimes(1);
  });

  it('does not try another credential after an ambiguous failure', async () => {
    primaryRpc.mockResolvedValue({
      error: { code: 'unexpected' },
      status: 503,
    });
    await expect(
      createRotatingGiglWorkerClient({
        GIGL_TRACKING_WORKER_TOKEN: 'primary',
        GIGL_TRACKING_WORKER_TOKEN_SECONDARY: 'secondary',
      })
    ).rejects.toThrow();
    expect(secondaryRpc).not.toHaveBeenCalled();
  });

  it('preserves the existing single-token path without a network probe', async () => {
    const result = await createRotatingGiglWorkerClient({
      GIGL_TRACKING_WORKER_TOKEN: 'primary',
    });
    expect(result.rpc).toBe(primaryRpc);
    expect(primaryRpc).not.toHaveBeenCalled();
  });

  it('uses a verified secondary when the primary has expired locally', async () => {
    createClient.mockImplementation((env: Record<string, string>) => {
      if (env.GIGL_TRACKING_WORKER_TOKEN === 'primary') throw new TokenError();
      return { rpc: secondaryRpc };
    });
    secondaryRpc.mockResolvedValue({ error: { code: '22023' }, status: 400 });
    const result = await createRotatingGiglWorkerClient({
      GIGL_TRACKING_WORKER_TOKEN: 'primary',
      GIGL_TRACKING_WORKER_TOKEN_SECONDARY: 'secondary',
    });
    expect(result.rpc).toBe(secondaryRpc);
  });

  it('keeps using a verified primary after the secondary expires', async () => {
    createClient.mockImplementation((env: Record<string, string>) => {
      if (env.GIGL_TRACKING_WORKER_TOKEN === 'secondary')
        throw new TokenError();
      return { rpc: primaryRpc };
    });
    primaryRpc.mockResolvedValue({ error: { code: '22023' }, status: 400 });
    const result = await createRotatingGiglWorkerClient({
      GIGL_TRACKING_WORKER_TOKEN: 'primary',
      GIGL_TRACKING_WORKER_TOKEN_SECONDARY: 'secondary',
    });
    expect(result.rpc).toBe(primaryRpc);
  });

  it('never treats a non-worker primary as a rotation failure', async () => {
    createClient.mockImplementation(() => {
      throw new RoleError();
    });
    await expect(
      createRotatingGiglWorkerClient({
        GIGL_TRACKING_WORKER_TOKEN: 'primary',
        GIGL_TRACKING_WORKER_TOKEN_SECONDARY: 'secondary',
      })
    ).rejects.toBeInstanceOf(RoleError);
    expect(secondaryRpc).not.toHaveBeenCalled();
  });

  it('does not ignore a non-worker secondary when the primary is usable', async () => {
    createClient.mockImplementation((env: Record<string, string>) => {
      if (env.GIGL_TRACKING_WORKER_TOKEN === 'secondary') throw new RoleError();
      return { rpc: primaryRpc };
    });
    await expect(
      createRotatingGiglWorkerClient({
        GIGL_TRACKING_WORKER_TOKEN: 'primary',
        GIGL_TRACKING_WORKER_TOKEN_SECONDARY: 'secondary',
      })
    ).rejects.toBeInstanceOf(RoleError);
    expect(primaryRpc).not.toHaveBeenCalled();
  });

  it('fails closed when both local credentials are unusable', async () => {
    createClient.mockImplementation(() => {
      throw new TokenError();
    });
    await expect(
      createRotatingGiglWorkerClient({
        GIGL_TRACKING_WORKER_TOKEN: 'primary',
        GIGL_TRACKING_WORKER_TOKEN_SECONDARY: 'secondary',
      })
    ).rejects.toBeInstanceOf(TokenError);
    expect(primaryRpc).not.toHaveBeenCalled();
    expect(secondaryRpc).not.toHaveBeenCalled();
  });
});
