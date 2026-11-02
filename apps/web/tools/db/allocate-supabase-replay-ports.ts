import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';

export const SUPABASE_REPLAY_PORT_KEYS = [
  'api.port',
  'db.port',
  'db.shadow_port',
  'studio.port',
  'inbucket.port',
  'edge_runtime.inspector_port',
  'analytics.port',
] as const;

export type SupabaseReplayPortKey = (typeof SUPABASE_REPLAY_PORT_KEYS)[number];
export type SupabaseReplayPortMap = Record<SupabaseReplayPortKey, number>;

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65_535;
}

function validatePortMap(ports: SupabaseReplayPortMap): void {
  if (
    Object.keys(ports).length !== SUPABASE_REPLAY_PORT_KEYS.length ||
    !SUPABASE_REPLAY_PORT_KEYS.every((key) => validPort(ports[key])) ||
    new Set(Object.values(ports)).size !== SUPABASE_REPLAY_PORT_KEYS.length
  ) {
    throw new Error('Invalid Supabase replay port map');
  }
}

function* randomCandidates(): Iterable<number> {
  const start = randomInt(20_000, 60_000);
  for (let offset = 0; offset < 40_000; offset += 1) {
    yield 20_000 + ((start - 20_000 + offset) % 40_000);
  }
}

export async function isLoopbackPortAvailable(port: number): Promise<boolean> {
  if (!validPort(port)) return false;
  for (const host of ['127.0.0.1', '0.0.0.0', '::'] as const) {
    const available = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', (error: NodeJS.ErrnoException) => {
        const unsupportedIpv6 =
          host === '::' &&
          ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(
            error.code ?? ''
          );
        resolve(unsupportedIpv6);
      });
      server.listen(
        {
          exclusive: true,
          host,
          port,
          ...(host === '::' ? { ipv6Only: true } : {}),
        },
        () => {
          server.close((error) => resolve(!error));
        }
      );
    });
    if (!available) return false;
  }
  return true;
}

export async function allocateSupabaseReplayPorts(
  defaults: SupabaseReplayPortMap,
  options: {
    candidates?: Iterable<number>;
    isAvailable?: (port: number) => Promise<boolean>;
  } = {}
): Promise<SupabaseReplayPortMap> {
  validatePortMap(defaults);
  const excluded = new Set(Object.values(defaults));
  const selected = new Set<number>();
  const ports = {} as SupabaseReplayPortMap;
  const keys = [...SUPABASE_REPLAY_PORT_KEYS];
  const isAvailable = options.isAvailable ?? isLoopbackPortAvailable;

  for (const candidate of options.candidates ?? randomCandidates()) {
    if (
      keys.length === 0 ||
      !validPort(candidate) ||
      excluded.has(candidate) ||
      selected.has(candidate) ||
      !(await isAvailable(candidate))
    ) {
      continue;
    }
    const key = keys.shift();
    if (!key) break;
    ports[key] = candidate;
    selected.add(candidate);
    if (keys.length === 0) break;
  }
  if (keys.length > 0) {
    throw new Error('Unable to allocate Supabase replay ports');
  }
  validatePortMap(ports);
  return ports;
}

export async function assertSupabaseReplayPortsAvailable(
  ports: SupabaseReplayPortMap,
  isAvailable: (port: number) => Promise<boolean> = isLoopbackPortAvailable
): Promise<void> {
  validatePortMap(ports);
  const availability = await Promise.all(
    SUPABASE_REPLAY_PORT_KEYS.map((key) => isAvailable(ports[key]))
  );
  if (availability.some((available) => !available)) {
    throw new Error('Supabase replay port race detected');
  }
}
