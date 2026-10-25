import { describe, expect, it, vi } from 'vitest';
import { OxygenProbe } from './session';

const customer = {
  accept_terms_and_condition: 'yes',
  user_category: 'individual',
  customer_personal_details: {
    external_identifier: 'test',
    first_name: 'Test',
    last_name: 'User',
    middle_name: '',
    phone_number: '2348000000000',
    email: 'test@example.com',
    bvn: '00000000000',
    nin: '00000000000',
    date_of_birth: '1990-01-01',
  },
  customer_bank_details: {
    bank_code: '044',
    bank_name: 'Test',
    account_number: '0000000000',
    account_name: 'Test User',
  },
  customer_employment_details: {
    employment_status: 'EMPLOYED',
    name_of_employer: 'Test',
    salary_amount: '100',
    salary_date: 29,
  },
};
function setup(replies: unknown[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply), { status: 200 });
    }
  );
  return {
    calls,
    probe: new OxygenProbe(
      {
        baseUrl: 'https://api.theoxygen.com/services/partners',
        environment: 'dev',
        reference: 'partner',
        secret: 'private-secret',
      },
      fetcher
    ),
  };
}
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
  it('does not retry creation after a lost response', async () => {
    const { probe, calls } = setup([
      { token: 'private-token', expires_in: 300 },
      new Error('private details'),
    ]);
    await probe.run('login', {});
    expect((await probe.run('create', customer)).code).toBe('indeterminate');
    expect((await probe.run('create', customer)).code).toBe('create_locked');
    expect(calls).toHaveLength(2);
  });
  it('blocks concurrent creation and mutations before login', async () => {
    const { probe, calls } = setup([]);
    expect((await probe.run('create', customer)).code).toBe('login_required');
    expect(calls).toHaveLength(0);
  });
  it('rejects unapproved hosts and production without explicit selection', () => {
    expect(
      () =>
        new OxygenProbe({
          baseUrl: 'https://evil.example',
          environment: 'dev',
          reference: 'a',
          secret: 'b',
        })
    ).toThrow();
    expect(
      () =>
        new OxygenProbe({
          baseUrl: 'https://api.oxygenx.africa/services/partners',
          environment: 'dev',
          reference: 'a',
          secret: 'b',
        })
    ).toThrow();
  });
  it('never exposes unrecognized provider messages or fields', async () => {
    const { probe } = setup([
      { token: 'private-token', expires_in: 300 },
      { loan_request_reference: 'req' },
      { message: 'private bvn', eligible: false, token: 'private' },
    ]);
    await probe.run('login', {});
    await probe.run('create', customer);
    const result = await probe.run('eligibility', {});
    expect(result.decision).toEqual({ kind: 'unknown' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result.shape).toEqual({
      message: 'string',
      eligible: 'boolean',
      token: 'redacted',
    });
  });
});

it('does not classify an affirmative payload on HTTP 500 as eligible', async () => {
  let index = 0;
  const fetcher = vi.fn(async () => {
    index += 1;
    return new Response(
      JSON.stringify(
        index === 1
          ? { token: 'token', expires_in: 300 }
          : index === 2
            ? { loan_request_reference: 'req' }
            : { successful: true, eligible: true, eligible_amount: 100 }
      ),
      { status: index === 3 ? 500 : 200 }
    );
  });
  const probe = new OxygenProbe(
    {
      baseUrl: 'https://api.theoxygen.com/services/partners',
      environment: 'dev',
      reference: 'partner',
      secret: 'secret',
    },
    fetcher
  );
  await probe.run('login', {});
  await probe.run('create', customer);
  expect((await probe.run('eligibility', {})).decision).toEqual({
    kind: 'unknown',
  });
});

it('loads documented banks with GET before creating a request and strips extra fields', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'private', expires_in: 300 }))
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          Status: '00',
          Result: [
            { Id: 6, Name: 'Access Bank', SortCode: '044', secret: 'private' },
          ],
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
  expect(await probe.run('banks', {})).toMatchObject({
    code: 'banks_loaded',
    banks: [{ name: 'Access Bank', code: '044' }],
  });
  expect(fetcher.mock.calls[1]).toEqual([
    expect.stringContaining('/v1/eligibility/banks'),
    expect.objectContaining({ method: 'GET', body: undefined }),
  ]);
});
it('rejects malformed bank lists without exposing arbitrary values', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'private', expires_in: 300 }))
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          Status: '00',
          Result: [{ Name: 'private', SortCode: 44 }],
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
  expect(await probe.run('banks', {})).toMatchObject({
    code: 'invalid_bank_response',
  });
});

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
