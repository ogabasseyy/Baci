import { expect, it, vi } from 'vitest';
import { OxygenProbe } from './session';
import { customer, setup } from './session.test-helpers';

it('resends new-user OTP for a resumed request without creating another application', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'OTP retriggered for validation' })
      )
    );
  const probe = new OxygenProbe(
    {
      baseUrl: 'https://api.oxygenx.africa/services/partners',
      environment: 'production',
      reference: 'partner',
      secret: 'secret',
      resumeState: {
        reference: 'existing-request',
        phone: '2348000000000',
        newUserToken: 'validation-token',
        token: 'private',
        expiresAt: Date.now() + 60000,
        customerPath: 'new',
      },
    },
    fetcher
  );
  expect(await probe.run('resend-otp', {})).toMatchObject({
    code: 'otp_resend_accepted',
    status: 200,
  });
  expect(fetcher.mock.calls[0]?.[0]).toEqual(
    expect.stringContaining('/v1/loan-request/retrigger/otp/new/user')
  );
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
    loan_request_reference: 'existing-request',
    partner_reference: 'partner',
  });
  expect(await probe.run('create', customer)).toMatchObject({
    code: 'create_locked',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('explicit existing-customer OTP test preserves the original branch and request', async () => {
  const { probe, calls } = setup([
    { token: 'private-token', expires_in: 300 },
    {
      loan_request_reference: 'req',
      token: 'customer-token',
      message: 'Customer creation initiated',
    },
    { Message: 'OTP retriggered for validation' },
    { message: 'OTP retriggered for validation' },
  ]);
  await probe.run('login', {});
  await probe.run('create', customer);
  await probe.run('resend-otp', { existingCustomerTest: true });
  expect(calls[2]?.url).toContain('/retrigger/otp/existing/user');
  expect(calls[2]?.body).toEqual({
    loan_request_reference: 'req',
    partner_reference: 'partner',
  });
  expect(probe.getUiState().customerPath).toBe('new');
  await probe.run('resend-otp', {});
  expect(calls[3]?.url).toContain('/retrigger/otp/new/user');
  expect(await probe.run('create', customer)).toMatchObject({
    code: 'create_locked',
  });
});
