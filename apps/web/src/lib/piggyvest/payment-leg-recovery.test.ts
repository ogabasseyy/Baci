import { expect, it, vi } from 'vitest';
import { createPaymentLegRecovery } from './payment-leg-recovery';
import { paymentLegRecoveryFixture } from './payment-leg-recovery.fixture';
import { PAYMENT_LEG_RECOVERY_STATEMENTS as statements } from './payment-leg-recovery-statements';

vi.mock('server-only', () => ({}));
it('reads canonical immutable intent through exact bounded scoped statement', async () => {
  const fixture = paymentLegRecoveryFixture();
  const execute = vi
    .fn()
    .mockResolvedValue({ rows: [{ result: fixture.result }] });
  expect(
    await createPaymentLegRecovery({
      configuration: fixture.configuration,
      execute,
    }).read(fixture.input)
  ).toEqual(fixture.result);
  const config = fixture.configuration;
  expect(execute).toHaveBeenCalledExactlyOnceWith(
    statements.paymentLegRecoveryRead.text,
    [
      config.integrationId,
      config.merchantId,
      config.customerId,
      config.goalId,
      config.expectedBusinessId,
      config.actorId,
      fixture.input.operationId,
      null,
    ]
  );
});
it('defaults disabled and rejects authority before executor', async () => {
  const fixture = paymentLegRecoveryFixture();
  const execute = vi.fn();
  const { enabled, ...configuration } = fixture.configuration;
  expect(enabled).toBe(true);
  expect(
    await createPaymentLegRecovery({ configuration, execute }).read(
      fixture.input
    )
  ).toMatchObject({ status: 'unavailable' });
  const store = createPaymentLegRecovery({
    configuration: fixture.configuration,
    execute,
  });
  expect(
    await store.observe({ ...fixture.input, amountKobo: 1 })
  ).toMatchObject({ status: 'unavailable' });
  expect(execute).not.toHaveBeenCalled();
  expect(() =>
    createPaymentLegRecovery({
      configuration: { ...configuration, transport: 'tls' },
      execute,
    })
  ).toThrow();
});
it('rejects missing or mismatched historical observations without dereferencing null or accepting a different reason', async () => {
  const fixture = paymentLegRecoveryFixture();
  const command = {
    ...fixture.input,
    observationId: fixture.input.operationId,
    leg: 'savings',
    reason: 'outcome_unconfirmed',
  };
  for (const historicalObservation of [
    null,
    {
      observationId: command.observationId,
      leg: 'savings',
      reason: 'contract_unconfirmed',
      recordedAt: '2026-09-12T00:00:00Z',
    },
  ]) {
    const result = {
      ...fixture.result,
      paymentLegRecovery: {
        ...fixture.result.paymentLegRecovery,
        historicalObservation,
      },
    };
    const execute = vi.fn().mockResolvedValue({ rows: [{ result }] });
    expect(
      await createPaymentLegRecovery({
        configuration: fixture.configuration,
        execute,
      }).observe(command)
    ).toMatchObject({ status: 'unavailable' });
    expect(execute).toHaveBeenCalledOnce();
  }
});
it('records only exact unresolved reasons, replaying the same identity without retry on loss', async () => {
  const fixture = paymentLegRecoveryFixture();
  const command = {
    ...fixture.input,
    observationId: fixture.input.operationId,
    leg: 'savings',
    reason: 'outcome_unconfirmed',
  };
  const observation = {
    observationId: command.observationId,
    leg: command.leg,
    reason: command.reason,
    recordedAt: '2026-09-12T00:00:00Z',
  };
  const result = {
    ...fixture.result,
    paymentLegRecovery: {
      ...fixture.result.paymentLegRecovery,
      historicalObservation: observation,
      legs: fixture.result.paymentLegRecovery.legs.map((leg) =>
        leg.leg === 'savings'
          ? { ...leg, observationCount: 1, latestObservation: observation }
          : leg
      ),
    },
  };
  const execute = vi.fn().mockResolvedValue({ rows: [{ result }] });
  const store = createPaymentLegRecovery({
    configuration: fixture.configuration,
    execute,
  });
  expect(await store.observe(command)).toEqual(result);
  expect(execute.mock.calls[0][0]).toBe(
    statements.paymentLegRecoveryObserve.text
  );
  expect(JSON.parse(execute.mock.calls[0][1][7])).toEqual({
    observationId: command.observationId,
    leg: command.leg,
    reason: command.reason,
  });
  execute.mockRejectedValueOnce(new Error('private'));
  expect(await store.observe(command)).toMatchObject({ status: 'unavailable' });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1]).toEqual(execute.mock.calls[0]);
});
it.each([
  { operationId: '30000000-0000-4000-8000-000000000999' },
  { paymentLegRecovery: null },
  { private: true },
])('rejects unproven or private result %j', async (patch) => {
  const fixture = paymentLegRecoveryFixture();
  const execute = vi
    .fn()
    .mockResolvedValue({ rows: [{ result: { ...fixture.result, ...patch } }] });
  expect(
    await createPaymentLegRecovery({
      configuration: fixture.configuration,
      execute,
    }).read(fixture.input)
  ).toMatchObject({ status: 'unavailable' });
});
