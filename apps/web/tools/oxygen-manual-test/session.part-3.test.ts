import { expect, it, vi } from 'vitest';
import { OxygenProbe } from './session';
import { customer } from './session.test-helpers';

it('resolves account name before create using only validated documented fields', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'private', expires_in: 300 }))
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          errorCode: 0,
          accountName: 'Test Account',
          bvn: 'private',
        })
      )
    );
  const probe = new OxygenProbe(
    {
      baseUrl: 'https://api.oxygenx.africa/services/partners',
      environment: 'production',
      reference: 'partner',
      secret: 'secret',
    },
    fetcher
  );
  await probe.run('login', {});
  const result = await probe.run('name-enquiry', {
    bank_code: '044',
    account_number: '0000000000',
    phone_number: '2348000000000',
    secret: 'discard',
  });
  expect(result).toMatchObject({
    code: 'account_name_resolved',
    accountName: 'Test Account',
  });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
    bank_code: '044',
    account_number: '0000000000',
    phone_number: '2348000000000',
    type: 'EXTERNAL',
  });
  expect(fetcher.mock.calls[1]?.[0]).toEqual(
    expect.stringContaining('/v1/partner-loans/name-enquiry')
  );
});
it('does not resolve failed enquiry or send invalid enquiry inputs', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'private', expires_in: 300 }))
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          errorCode: 1,
          accountName: 'Do not use',
        })
      )
    );
  const probe = new OxygenProbe(
    {
      baseUrl: 'https://api.oxygenx.africa/services/partners',
      environment: 'production',
      reference: 'partner',
      secret: 'secret',
    },
    fetcher
  );
  await probe.run('login', {});
  expect(await probe.run('name-enquiry', {})).toMatchObject({
    code: 'invalid_input',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const result = await probe.run('name-enquiry', {
    bank_code: '044',
    account_number: '0000000000',
    phone_number: '2348000000000',
  });
  expect(result.code).toBe('account_name_unresolved');
  expect(JSON.stringify(result)).not.toContain('Do not use');
});
it('requires a manual risk acknowledgement after JSON 400 and never retries automatically', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'private', expires_in: 300 }))
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: 'Invalid customer details', status: 400 }),
        { status: 400 }
      )
    );
  const probe = new OxygenProbe(
    {
      baseUrl: 'https://api.oxygenx.africa/services/partners',
      environment: 'production',
      reference: 'partner',
      secret: 'secret',
    },
    fetcher
  );
  await probe.run('login', {});
  await probe.run('create', customer);
  expect(await probe.run('prepare-retry', {})).toMatchObject({
    code: 'retry_acknowledgement_required',
  });
  expect(
    await probe.run('prepare-retry', { acknowledge_duplicate_risk: true })
  ).toMatchObject({ code: 'retry_ready' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not unlock a timed-out creation via acknowledgement', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'private', expires_in: 300 }))
    )
    .mockRejectedValueOnce(new Error('timeout'));
  const probe = new OxygenProbe(
    {
      baseUrl: 'https://api.oxygenx.africa/services/partners',
      environment: 'production',
      reference: 'partner',
      secret: 'secret',
    },
    fetcher
  );
  await probe.run('login', {});
  await probe.run('create', customer);
  expect(
    await probe.run('prepare-retry', { acknowledge_duplicate_risk: true })
  ).toMatchObject({ code: 'retry_unavailable' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
