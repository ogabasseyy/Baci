import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-checkout.test-fixture';
import { enabledPrimaryCardRuntimeEnv } from '@/lib/piggyvest/primary-wallet-card-checkout-runtime.test-support';
import { primaryWalletCardCheckoutRouteFixture } from '../primary-wallet-card-checkout-route.test-fixture';
import { POST } from './route';

// The real route and handler run here. Only the outer boundaries are
// spies: the auth client, CSRF, the runtime readers (wrapping the real
// ones), the PostgreSQL driver and global fetch (Paystack). None may run.
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  pgClient: vi.fn(),
  runtime: vi.fn(),
  runtimeDrain: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('pg', () => ({
  Client: class {
    constructor(options: unknown) {
      mocks.pgClient(options);
    }
    connect = vi.fn();
    query = vi.fn();
    end = vi.fn();
  },
}));
vi.mock(
  '@/lib/piggyvest/primary-wallet-card-checkout-runtime',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/piggyvest/primary-wallet-card-checkout-runtime')
      >();
    mocks.runtime.mockImplementation(
      actual.readPrimaryWalletCardCheckoutRuntime
    );
    mocks.runtimeDrain.mockImplementation(
      actual.readPrimaryWalletCardCheckoutRuntimeDrain
    );
    return {
      readPrimaryWalletCardCheckoutRuntime: mocks.runtime,
      readPrimaryWalletCardCheckoutRuntimeDrain: mocks.runtimeDrain,
    };
  }
);

const fetchSpy = vi.spyOn(globalThis, 'fetch');
beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries(enabledPrimaryCardRuntimeEnv))
    vi.stubEnv(name, value);
  mocks.auth.mockResolvedValue(
    primaryWalletCardCheckoutRouteFixture('initialize').auth
  );
  mocks.csrf.mockResolvedValue({ valid: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// Records every PIGGYVEST_PRIMARY_CARD_* lookup made while `run` executes.
async function recordPrimaryCardEnvReads(run: () => Promise<void>) {
  const reads: string[] = [];
  const original = process.env;
  process.env = new Proxy(original, {
    get(target, key, receiver) {
      if (typeof key === 'string' && key.startsWith('PIGGYVEST_PRIMARY_CARD_'))
        reads.push(key);
      return Reflect.get(target, key, receiver);
    },
  });
  try {
    await run();
  } finally {
    process.env = original;
  }
  return reads;
}

function expectNoBoundaryReached() {
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.csrf).not.toHaveBeenCalled();
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.runtimeDrain).not.toHaveBeenCalled();
  expect(mocks.pgClient).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
}

it('starts from a complete primary card environment the strict reader would enable', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/piggyvest/primary-wallet-card-checkout-runtime')
  >('@/lib/piggyvest/primary-wallet-card-checkout-runtime');
  expect(
    actual.readPrimaryWalletCardCheckoutRuntime(process.env)?.settings
  ).toMatchObject({ merchantId: fixture.settings.merchantId });
});

it('answers 410 PRIMARY_CARD_FUNDING_RETIRED before any env, auth, Paystack or database access', async () => {
  let response: Response | undefined;
  const reads = await recordPrimaryCardEnvReads(async () => {
    response = await POST(
      primaryWalletCardCheckoutRouteFixture('initialize').request()
    );
  });
  expect(response?.status).toBe(410);
  expect(response?.headers.get('cache-control')).toBe('no-store');
  expect(await response?.json()).toEqual({
    error:
      'Card top-up into this wallet is no longer available. Please use another way to fund your wallet.',
    code: 'PRIMARY_CARD_FUNDING_RETIRED',
  });
  expect(reads).toEqual([]);
  expectNoBoundaryReached();
});

it.each([
  ['an unauthenticated caller', { user: null }],
  ['a malformed body', null],
])('refuses %s with the same 410', async (_label, authOverride) => {
  if (authOverride) mocks.auth.mockResolvedValue(authOverride);
  const response = await POST(
    primaryWalletCardCheckoutRouteFixture('initialize').request(
      authOverride ? undefined : { merchantId: 'not-a-uuid' }
    )
  );
  expect(response.status).toBe(410);
  expect((await response.json()).code).toBe('PRIMARY_CARD_FUNDING_RETIRED');
  expectNoBoundaryReached();
});
