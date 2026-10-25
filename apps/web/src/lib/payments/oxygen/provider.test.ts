import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOxygenProvider } from './provider';

describe('Oxygen provider boundary', () => {
  it('uses the staging API and sends approval as multipart without activation', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const provider = createOxygenProvider({
      token: async () => 'private',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ status: 'APPROVED' });
      },
    });
    const form = new FormData();
    form.set('otp', '123456');
    expect(await provider.call('approve', form)).toEqual({
      status: 'APPROVED',
    });
    expect(calls[0].url).toBe(
      'https://staging-api.theoxygen.com/services/partners/v1/partner-loans/approve-loan'
    );
    expect(calls[0].init?.body).toBe(form);
    expect(new Headers(calls[0].init?.headers).has('content-type')).toBe(false);
  });
  it('rejects activation or arbitrary paths before getting credentials', async () => {
    const token = vi.fn();
    const fetcher = vi.fn();
    const provider = createOxygenProvider({ token, fetch: fetcher });
    // Runtime callers, including forged requests, cannot add an operation.
    await expect(provider.call('activate' as never, {})).rejects.toThrow(
      'Unsupported Oxygen operation'
    );
    expect(token).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not retry or expose provider errors', async () => {
    let calls = 0;
    const provider = createOxygenProvider({
      token: async () => 'private',
      fetch: async () => {
        calls++;
        return new Response('secret identity', { status: 400 });
      },
    });
    await expect(provider.call('kyc', {})).rejects.toThrow(
      'Oxygen request could not be confirmed'
    );
    expect(calls).toBe(1);
  });
});

it.each([
  [400, 'rejected'],
  [408, 'indeterminate'],
  [500, 'indeterminate'],
] as const)('classifies HTTP %s without retry', async (status, outcome) => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response('private', { status }));
  const provider = createOxygenProvider({
    token: async () => 'private',
    fetch: fetcher,
  });
  await expect(provider.call('book', {})).rejects.toMatchObject({ outcome });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('records login failure before sending as not sent', async () => {
  const fetcher = vi.fn();
  const provider = createOxygenProvider({
    token: async () => {
      throw new Error('private');
    },
    fetch: fetcher,
  });
  await expect(provider.call('book', {})).rejects.toMatchObject({
    outcome: 'not_sent',
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it('loads banks with GET and resolves accounts with POST at fixed staging paths', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ Status: '00' }));
  const provider = createOxygenProvider({
    token: async () => 'private',
    fetch: fetcher,
  });
  await provider.call('banks' as never, {});
  expect(fetcher).toHaveBeenCalledWith(
    expect.stringContaining('/v1/eligibility/banks'),
    expect.objectContaining({ method: 'GET', body: undefined })
  );
  fetcher.mockResolvedValue(Response.json({ success: true }));
  await provider.call('name_enquiry' as never, { bank_code: '001' });
  expect(fetcher).toHaveBeenLastCalledWith(
    expect.stringContaining('/v1/partner-loans/name-enquiry'),
    expect.objectContaining({ method: 'POST' })
  );
});

it('maps the known booking statement rejection to a safe code without raw provider data', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json(
      {
        message:
          'User does not have a valid statement and user has option to add another bank',
        privateDetails: 'private bank details',
      },
      { status: 400 }
    )
  );
  const provider = createOxygenProvider({
    token: async () => 'private',
    fetch: fetcher,
  });
  await expect(provider.call('book', {})).rejects.toMatchObject({
    outcome: 'rejected',
    code: 'OXYGEN_STATEMENT_REQUIRED',
    message: 'Oxygen request could not be confirmed',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not classify an oversized error response as the known statement rejection', async () => {
  const provider = createOxygenProvider({
    token: async () => 'private',
    fetch: async () =>
      Response.json({ message: 'x'.repeat(17000) }, { status: 400 }),
  });
  await expect(provider.call('book', {})).rejects.toMatchObject({
    outcome: 'rejected',
    code: undefined,
  });
});
it('retains safe login status and static transport code without sending the operation', async () => {
  const { OxygenTransportError } = await import('./transport');
  const fetcher = vi.fn();
  const provider = createOxygenProvider({
    token: async () => {
      throw new OxygenTransportError('auth_failed', 401);
    },
    fetch: fetcher,
  });
  await expect(provider.call('book', {})).rejects.toMatchObject({
    outcome: 'not_sent',
    diagnostic: {
      kind: 'authentication',
      httpStatus: 401,
      providerCode: 'auth_failed',
      providerMessage: 'Oxygen partner authentication failed.',
    },
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  'validate_existing',
  'validate_new',
] as const)('recognizes the observed invalid OTP response for %s', async (operation) => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { message: 'OTP validation failed. Please try again' },
        { status: 400 }
      )
    );
  const provider = createOxygenProvider({
    token: async () => 'secret',
    fetch: fetcher,
  });
  await expect(
    provider.call(operation, { otp: '123456' })
  ).rejects.toMatchObject({ outcome: 'rejected', code: 'OXYGEN_OTP_INVALID' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  ['validate_existing', 500, 'OTP validation failed. Please try again'],
  ['validate_new', 400, 'Unknown validation error'],
  ['book', 400, 'OTP validation failed. Please try again'],
] as const)('does not mislabel another provider failure as an invalid OTP (%s %s)', async (operation, status, message) => {
  const provider = createOxygenProvider({
    token: async () => 'secret',
    fetch: async () => Response.json({ message }, { status }),
  });
  await expect(provider.call(operation, {})).rejects.toMatchObject({
    code: undefined,
  });
});

it.each([
  ['book', 400, 'User has an active loan', 'OXYGEN_ACTIVE_LOAN'],
  ['book', 500, 'User has an active loan', undefined],
  ['eligibility', 400, 'User has an active loan', undefined],
  ['book', 400, 'Unexpected loan error', undefined],
] as const)('maps active loan only for a definite recognised booking rejection (%s %s)', async (operation, status, message, code) => {
  const provider = createOxygenProvider({
    token: async () => 'private',
    fetch: vi
      .fn()
      .mockResolvedValue(
        Response.json({ message, privateDetails: 'private' }, { status })
      ),
  });
  await expect(provider.call(operation, {})).rejects.toMatchObject({ code });
});

it.each([
  ['upfront_link', '/v1/partner-loans/send/split/payment-setup'],
  ['repayment_link', '/v1/partner-loans/send/payment-setup'],
] as const)('supports documented %s recovery without approval', async (operation, path) => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ url: 'https://payment.hydrogenpay.com/' })
    );
  const provider = createOxygenProvider({
    token: async () => 'private',
    fetch: fetcher,
  });
  await provider.call(operation, { loan_reference: 'synthetic' });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    `https://staging-api.theoxygen.com/services/partners${path}`,
    expect.objectContaining({
      method: 'POST',
      body: '{"loan_reference":"synthetic"}',
    })
  );
});
