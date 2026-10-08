import { beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';
import { createPrimaryCardCustodySignedRuntime } from './primary-wallet-card-custody-signed-runtime';

const mocks = vi.hoisted(() => ({
  readiness: vi.fn(),
  acceptSigned: vi.fn(),
  drain: vi.fn(),
}));
vi.mock('./primary-wallet-card-custody-inbox', () => ({
  createPrimaryCardCustodyInbox: () => mocks,
}));
beforeEach(() => vi.clearAllMocks());
function runtime(environment: NodeJS.ProcessEnv = fixture.environment) {
  return createPrimaryCardCustodySignedRuntime({
    environment,
    fetchImplementation: vi.fn(),
    resolveAuthenticatedCrosswalk: vi.fn(),
    now: () => fixture.now,
  });
}
describe('minimal signature-verified webhook and durable worker hook', () => {
  it('acks durable queue intake distinctly from card collection and provider funding', async () => {
    mocks.acceptSigned.mockResolvedValue('accepted');
    const response = await runtime().handleWebhook(
      fixture.rawBody,
      fixture.signature
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      received: true,
      custodyQueued: true,
      duplicate: false,
    });
  });
  it('returns retryable sanitized HTTP failure on storage I/O, never successful deferred ack', async () => {
    mocks.acceptSigned.mockRejectedValue(new Error('private storage details'));
    const response = await runtime().handleWebhook(
      fixture.rawBody,
      fixture.signature
    );
    expect(response?.status).toBe(503);
    expect(await response?.text()).not.toContain('private storage details');
  });
  it('acks conflicts only when the private inbox durably quarantined the alternate bytes', async () => {
    mocks.acceptSigned.mockResolvedValue('conflict');
    expect(
      await (
        await runtime().handleWebhook(fixture.rawBody, fixture.signature)
      )?.json()
    ).toEqual({ received: true, quarantined: true });
  });
  it('returns no hook response for a positively identified unrelated event', async () => {
    mocks.acceptSigned.mockResolvedValue('not_handled');
    expect(
      await runtime().handleWebhook(fixture.rawBody, fixture.signature)
    ).toBeNull();
  });
  it('fails closed with explicit readiness when provider capability is not configured', async () => {
    const input = runtime({
      ...fixture.environment,
      PIGGYVEST_PRIMARY_CARD_SIGNED_MAPPING_CONTRACT: undefined,
    });
    expect(await input.readiness()).toEqual({
      ready: false,
      reason: 'configuration_unavailable',
    });
    expect(
      (await input.handleWebhook(fixture.rawBody, fixture.signature))?.status
    ).toBe(503);
    await expect(input.runWorker()).rejects.toThrow(
      'Signed custody configuration unavailable'
    );
    expect(mocks.acceptSigned).not.toHaveBeenCalled();
  });
  it('propagates worker failures rather than reporting completion', async () => {
    mocks.drain.mockRejectedValue(new Error('worker failed'));
    await expect(runtime().runWorker()).rejects.toThrow('worker failed');
  });
});
