import { beforeEach, expect, it, vi } from 'vitest';
import { primaryBankInboxFixture as fixture } from './primary-wallet-bank-inbox.test-fixture';
import { drainPrimaryWalletBankInbox } from './primary-wallet-bank-inbox-worker';

// The engine readiness gate runs before any claim: a refused or failed check
// leaves every stored delivery pending exactly as captured (no claim, so no
// attempt is spent and no lease is taken), and it credits once later.
const store = vi.hoisted(() => ({
  readiness: vi.fn(),
  engineReady: vi.fn(),
  claim: vi.fn(),
  process: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-bank-inbox-store', () => ({
  createPrimaryWalletBankInboxStore: () => store,
}));

const idle = { claimed: 0, processed: 0, deferred: 0, blocked: 0 };
// A gated drain says why (marker ids only, never customer data), so it is
// distinguishable from an empty inbox.
const gated = (missing: string[]) => ({ ...idle, engineNotReady: missing });

beforeEach(() => {
  vi.clearAllMocks();
  store.readiness.mockResolvedValue(true);
  store.engineReady.mockResolvedValue({ ready: true, missing: [] });
  store.claim.mockResolvedValue([fixture.claim]);
  store.process.mockResolvedValue('credited');
  store.retry.mockResolvedValue(true);
});

it('claims no rows while the engine is not ready', async () => {
  store.engineReady.mockResolvedValue({
    ready: false,
    missing: ['engine_readiness_not_installed'],
  });
  expect(await drainPrimaryWalletBankInbox({ env: fixture.env })).toEqual(
    gated(['engine_readiness_not_installed'])
  );
  expect(store.claim).not.toHaveBeenCalled();
  expect(store.process).not.toHaveBeenCalled();
  expect(store.retry).not.toHaveBeenCalled();
});

it('counts an engine readiness database error as not ready', async () => {
  store.engineReady.mockRejectedValue(
    new Error('Primary bank inbox database unavailable')
  );
  expect(await drainPrimaryWalletBankInbox({ env: fixture.env })).toEqual(
    gated(['engine_readiness_unavailable'])
  );
  expect(store.claim).not.toHaveBeenCalled();
  expect(store.process).not.toHaveBeenCalled();
});

it('counts a malformed readiness answer as not ready', async () => {
  for (const answer of [
    undefined,
    { ready: 'true', missing: [] },
    { ready: true, missing: ['heartbeat_stale'] },
  ]) {
    store.engineReady.mockResolvedValueOnce(answer);
    expect(await drainPrimaryWalletBankInbox({ env: fixture.env })).toEqual(
      gated(['engine_readiness_unavailable'])
    );
  }
  expect(store.claim).not.toHaveBeenCalled();
});

it('checks the bank-inbox surface after the session check and before the claim', async () => {
  expect(await drainPrimaryWalletBankInbox({ env: fixture.env })).toEqual({
    claimed: 1,
    processed: 1,
    deferred: 0,
    blocked: 0,
  });
  const readinessOrder = store.readiness.mock.invocationCallOrder[0];
  const engineOrder = store.engineReady.mock.invocationCallOrder[0];
  const claimOrder = store.claim.mock.invocationCallOrder[0];
  expect(readinessOrder).toBeLessThan(engineOrder);
  expect(engineOrder).toBeLessThan(claimOrder);
});

it('stops before the engine check when the drain is aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(
    await drainPrimaryWalletBankInbox({
      env: fixture.env,
      signal: controller.signal,
    })
  ).toEqual(idle);
  expect(store.engineReady).not.toHaveBeenCalled();
  expect(store.claim).not.toHaveBeenCalled();
});
