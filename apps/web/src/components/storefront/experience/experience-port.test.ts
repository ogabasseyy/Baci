import { expect, it, vi } from 'vitest';
import { createExperiencePort } from './experience-port';

it('rejects stale epochs and changed request replay before dispatch; pending old route response resolves once', async () => {
  let epoch = 1;
  const dispatch = vi.fn(async () => ({
    status: 'ok' as const,
    value: { lines: [] },
  }));
  const port = createExperiencePort(
    { instanceId: 'i', buildDigest: 'a'.repeat(64), shopperPartition: 'p' },
    () => ({
      epoch,
      routeId: 'home',
      params: {},
      canonicalPath: '/',
      publicDataRevision: '1',
    }),
    dispatch
  );
  const request = {
    protocol: 'baci-commerce/1',
    instanceId: 'i',
    buildDigest: 'a'.repeat(64),
    routeEpoch: 1,
    requestId: 'r',
    capability: 'cart.read-public',
    method: 'cart.readPublic',
    args: {},
  };
  await port.receive(request);
  await port.receive(request);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(
    (await port.receive({ ...request, args: { secret: true } })).status
  ).toBe('error');
  epoch = 2;
  expect((await port.receive({ ...request, requestId: 's' })).status).toBe(
    'error'
  );
  expect(dispatch).toHaveBeenCalledTimes(1);
  port.destroy();
  expect((await port.receive({ ...request, routeEpoch: 2 })).status).toBe(
    'error'
  );
});

it('continues browsing beyond the bounded settled replay window', async () => {
  const dispatch = vi.fn(async () => ({
    status: 'ok' as const,
    value: { lines: [] },
  }));
  const port = createExperiencePort(
    { instanceId: 'i', buildDigest: 'a'.repeat(64), shopperPartition: 'p' },
    () => ({
      epoch: 1,
      routeId: 'home',
      params: {},
      canonicalPath: '/',
      publicDataRevision: '1',
    }),
    dispatch
  );
  for (let n = 0; n < 300; n++) {
    const result = await port.receive({
      protocol: 'baci-commerce/1',
      instanceId: 'i',
      buildDigest: 'a'.repeat(64),
      routeEpoch: 1,
      requestId: `read-${n}`,
      capability: 'cart.read-public',
      method: 'cart.readPublic',
      args: {},
    });
    expect(result.status).toBe('ok');
  }
  expect(dispatch).toHaveBeenCalledTimes(300);
  port.destroy();
});

it('never evicts pending requests to admit more work or dispatch a replay twice', async () => {
  let finish: ((value: { status: 'ok'; value: null }) => void) | undefined;
  const pending = new Promise<{ status: 'ok'; value: null }>((resolve) => {
    finish = resolve;
  });
  const dispatch = vi.fn(() => pending);
  const port = createExperiencePort(
    { instanceId: 'i', buildDigest: 'a'.repeat(64), shopperPartition: 'p' },
    () => ({
      epoch: 1,
      routeId: 'home',
      params: {},
      canonicalPath: '/',
      publicDataRevision: '1',
    }),
    dispatch
  );
  const request = (n: number) => ({
    protocol: 'baci-commerce/1',
    instanceId: 'i',
    buildDigest: 'a'.repeat(64),
    routeEpoch: 1,
    requestId: `pending-${n}`,
    capability: 'cart.read-public',
    method: 'cart.readPublic',
    args: {},
  });
  const operations = Array.from({ length: 256 }, (_, n) =>
    port.receive(request(n))
  );
  const replay = port.receive(request(0));
  expect((await port.receive(request(256))).status).toBe('error');
  finish?.({ status: 'ok', value: null });
  await Promise.all([...operations, replay]);
  expect(dispatch).toHaveBeenCalledTimes(256);
  expect((await port.receive(request(256))).status).toBe('ok');
  port.destroy();
});
