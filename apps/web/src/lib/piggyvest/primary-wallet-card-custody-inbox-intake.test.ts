import { describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';
import { createPrimaryCardCustodyInboxIntake } from './primary-wallet-card-custody-inbox-intake';

function setup() {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(fixture.ready)
    .mockResolvedValueOnce('accepted');
  const accept = createPrimaryCardCustodyInboxIntake({
    configuration: fixture.configuration,
    capability: fixture.capability,
    execute,
    now: () => fixture.now,
  });
  return { execute, accept };
}
describe('private signed raw-byte custody intake', () => {
  it('acks intake only after bounded exact signed bytes commit, without collection or funding', async () => {
    const input = setup();
    expect(await input.accept(fixture.rawBody, fixture.signature)).toBe(
      'accepted'
    );
    expect(input.execute.mock.calls[1]).toEqual([
      'inboxEnqueue',
      [fixture.capability, fixture.claim.rawHex, fixture.signature],
    ]);
    expect(input.execute.mock.calls.map(([action]) => action)).toEqual([
      'inboxReadiness',
      'inboxEnqueue',
    ]);
  });
  it('never stores unsigned bytes or constructs an operation from unsigned metadata', async () => {
    const input = setup();
    expect(await input.accept(fixture.rawBody, null)).toBe('invalid_signature');
    expect(input.execute).not.toHaveBeenCalled();
  });
  it('retains the signature-verified snapshot if caller mutates its buffer during readiness I/O', async () => {
    const input = setup();
    const body = Buffer.from(fixture.rawBody);
    input.execute.mockImplementationOnce(async () => {
      body.fill(0);
      return fixture.ready;
    });
    expect(await input.accept(body, fixture.signature)).toBe('accepted');
    expect(input.execute.mock.calls[1][1][1]).toBe(fixture.claim.rawHex);
  });
  it('does not pretend mapping is ready when database capability is absent', async () => {
    const input = setup();
    input.execute.mockReset().mockResolvedValue({ ready: false });
    expect(await input.accept(fixture.rawBody, fixture.signature)).toBe(
      'not_ready'
    );
    expect(input.execute).toHaveBeenCalledTimes(1);
  });
  it('propagates storage failure and invalid acknowledgement rather than acknowledging intake', async () => {
    const input = setup();
    input.execute
      .mockReset()
      .mockResolvedValueOnce(fixture.ready)
      .mockRejectedValueOnce(new Error('storage failed'));
    await expect(
      input.accept(fixture.rawBody, fixture.signature)
    ).rejects.toThrow('storage failed');
    input.execute
      .mockReset()
      .mockResolvedValueOnce(fixture.ready)
      .mockResolvedValueOnce(false);
    await expect(
      input.accept(fixture.rawBody, fixture.signature)
    ).rejects.toThrow();
  });
  it('does not take an unrelated owner source event from another source wallet', async () => {
    const input = setup();
    input.execute.mockReset().mockResolvedValue({
      ...fixture.ready,
      sourceWalletId: 'other-treasury',
    });
    expect(await input.accept(fixture.rawBody, fixture.signature)).toBe(
      'not_handled'
    );
    expect(input.execute).toHaveBeenCalledTimes(1);
  });
});
