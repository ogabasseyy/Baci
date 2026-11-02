import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allocateSupabaseReplayPorts,
  assertSupabaseReplayPortsAvailable,
  isLoopbackPortAvailable,
  SUPABASE_REPLAY_PORT_KEYS,
  type SupabaseReplayPortMap,
} from './allocate-supabase-replay-ports';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

const defaults = Object.fromEntries(
  SUPABASE_REPLAY_PORT_KEYS.map((key, index) => [key, 54_320 + index])
) as SupabaseReplayPortMap;

function* exactCandidates(): Iterable<number> {
  for (let index = 0; index < SUPABASE_REPLAY_PORT_KEYS.length; index += 1) {
    yield 41_000 + index;
  }
  throw new Error('extra candidate consumed');
}

describe('allocateSupabaseReplayPorts', () => {
  it('selects a unique non-default port for every qualified key', async () => {
    const unavailable = new Set([40_000, 40_003]);
    const ports = await allocateSupabaseReplayPorts(defaults, {
      candidates: Array.from({ length: 16 }, (_, index) => 40_000 + index),
      isAvailable: async (port) => !unavailable.has(port),
    });

    expect(Object.keys(ports)).toEqual(SUPABASE_REPLAY_PORT_KEYS);
    expect(new Set(Object.values(ports)).size).toBe(
      SUPABASE_REPLAY_PORT_KEYS.length
    );
    expect(Object.values(ports)).not.toContain(40_000);
    expect(Object.values(ports)).not.toContain(40_003);
    for (const port of Object.values(ports)) {
      expect(Object.values(defaults)).not.toContain(port);
    }
  });

  it('stops consuming candidates after the last key receives a port', async () => {
    await expect(
      allocateSupabaseReplayPorts(defaults, {
        candidates: exactCandidates(),
        isAvailable: async () => true,
      })
    ).resolves.toEqual(
      Object.fromEntries(
        SUPABASE_REPLAY_PORT_KEYS.map((key, index) => [key, 41_000 + index])
      )
    );
  });

  it('detects a real loopback listener without closing it', async () => {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');

    await expect(isLoopbackPortAvailable(address.port)).resolves.toBe(false);
    expect(server.listening).toBe(true);
  });

  it('rejects a wildcard-bound listener even when loopback can bind separately', async () => {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');

    const loopbackProbe = createServer();
    let loopbackCanBind = true;
    try {
      await new Promise<void>((resolve, reject) => {
        loopbackProbe.once('error', () => {
          loopbackCanBind = false;
          resolve();
        });
        loopbackProbe.listen(address.port, '127.0.0.1', resolve);
      });
    } finally {
      if (loopbackProbe.listening)
        await new Promise<void>((resolve, reject) =>
          loopbackProbe.close((error) => (error ? reject(error) : resolve()))
        );
    }
    if (process.platform === 'darwin') expect(loopbackCanBind).toBe(true);

    await expect(isLoopbackPortAvailable(address.port)).resolves.toBe(false);
    expect(server.listening).toBe(true);
  });

  it('fails a pre-start race without disclosing the occupied port', async () => {
    await expect(
      assertSupabaseReplayPortsAvailable(defaults, async () => false)
    ).rejects.toThrow(/^Supabase replay port race detected$/);
  });
});
