import { describe, expect, it, vi } from 'vitest';
import { OxygenProbe } from './session';
import { customer, setup } from './session.test-helpers';

describe('manual Oxygen probe', () => {
  it('recognizes the staging eligibility report for the saved request without exposing references or messages', async () => {
    const { probe } = setup([
      { token: 'private-token', expires_in: 300 },
      { loan_request_reference: 'req', message: 'OTP sent for validation' },
      {
        loan_request_reference: 'req',
        partner_reference: 'partner',
        is_eligible: true,
        status: 'ELIGIBLE',
        message: 'private identity information',
      },
    ]);
    await probe.run('login', {});
    await probe.run('create', customer);
    const checkpoint = probe.getCheckpointState();
    const result = await probe.run('eligibility', {});
    expect(result.code).toBe('eligibility_report_received');
    expect(result.eligibilityReport).toEqual({
      isEligible: true,
      providerStatus: 'ELIGIBLE',
      nextStep: 'confirm_credit_limit_and_remaining_kyc',
    });
    expect(result.decision).toEqual({ kind: 'unknown' });
    expect(JSON.stringify(result)).not.toContain(
      'private identity information'
    );
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(probe.getCheckpointState()).toEqual(checkpoint);
  });
  it('resumes the same request after restart without persisting partner authentication', async () => {
    const { probe } = setup([
      { token: 'private-token', expires_in: 300 },
      {
        loan_request_reference: 'req',
        token: 'customer-token',
        message: 'Customer creation initiated',
      },
    ]);
    await probe.run('login', {});
    await probe.run('create', customer);
    const saved = probe.getCheckpointState();
    expect(JSON.stringify(saved)).not.toContain('private-token');
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ token: 'fresh', expires_in: 300 }))
    );
    const restarted = new OxygenProbe(
      {
        baseUrl: 'https://api.theoxygen.com/services/partners',
        environment: 'dev',
        reference: 'partner',
        secret: 'secret',
        checkpoint: saved,
      },
      fetcher
    );
    expect(restarted.getUiState().requestCreated).toBe(true);
    expect((await restarted.run('validate-new', { otp: '123456' })).code).toBe(
      'login_required'
    );
    await restarted.run('login', {});
    expect((await restarted.run('create', customer)).code).toBe(
      'create_locked'
    );
    await restarted.run('validate-new', { otp: '123456' });
    const sent = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));
    expect(sent).toMatchObject({
      loan_request_reference: 'req',
      phone_number: customer.customer_personal_details.phone_number,
      token: 'customer-token',
    });
  });
  it('saves the create lock before calling Oxygen and stops when storage fails', async () => {
    const order: string[] = [];
    const fetcher = vi.fn(async () => {
      order.push('fetch');
      return new Response(
        JSON.stringify({ token: 'partner-token', expires_in: 300 })
      );
    });
    const persist = vi.fn(async () => {
      order.push('save');
      throw new Error('disk failed');
    });
    const probe = new OxygenProbe(
      {
        baseUrl: 'https://api.theoxygen.com/services/partners',
        environment: 'dev',
        reference: 'partner',
        secret: 'secret',
        persistCheckpoint: persist,
      },
      fetcher
    );
    await probe.run('login', {});
    order.length = 0;
    expect((await probe.run('create', customer)).code).toBe('checkpoint_error');
    expect(order).toEqual(['save']);
    expect((await probe.run('create', customer)).code).toBe('checkpoint_error');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses staging only with its matching host and rejects production pairing', async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ token: 'test-token', expires_in: 300 }))
    );
    const config = {
      environment: 'staging' as const,
      baseUrl: 'https://staging-api.theoxygen.com/services/partners',
      reference: 'test',
      secret: 'test-secret',
    };
    const probe = new OxygenProbe(config, fetcher);
    expect((await probe.run('login', {})).code).toBe('authenticated');
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `${config.baseUrl}/v1/partner/login`
    );
    expect(
      () =>
        new OxygenProbe({
          ...config,
          baseUrl: 'https://api.oxygenx.africa/services/partners',
        })
    ).toThrow('Unsupported environment pairing');
  });
  it('uses server references, validates OTP and emits only sanitized eligibility', async () => {
    const { probe, calls } = setup([
      { token: 'private-token', expires_in: 300 },
      {
        loan_request_reference: 'req',
        message: 'OTP sent for validation',
        bvn: 'private-identity',
      },
      { message: 'OTP validation successful' },
      { successful: true, eligible: true, eligible_amount: 100 },
    ]);
    await probe.run('login', {});
    const created = await probe.run('create', customer);
    expect(created.customerPath).toBe('existing');
    expect(JSON.stringify(created)).not.toMatch(/private|req"/);
    await probe.run('validate-existing', { otp: '123456' });
    const result = await probe.run('eligibility', {});
    expect(calls[2]?.body).toEqual({
      phone_number: '2348000000000',
      otp: '123456',
      loan_request_reference: 'req',
      partner_reference: 'partner',
    });
    expect(calls[3]?.body).toEqual({
      loan_request_reference: 'req',
      partner_reference: 'partner',
    });
    expect(result.decision).toEqual({ kind: 'eligible', eligibleAmount: 100 });
  });
});
