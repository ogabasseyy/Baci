import { describe, expect, it, vi } from 'vitest';
import { OxygenProbe } from './session';
import { customer, setup } from './session.test-helpers';

describe('manual Oxygen probe', () => {
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
