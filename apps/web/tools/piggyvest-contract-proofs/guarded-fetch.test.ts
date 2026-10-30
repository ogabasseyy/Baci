import { describe, expect, it } from 'vitest';
import { AUTH, build, ORIGIN, refusal } from './guarded-fetch.test-support';

describe('guarded fetch: destination and credentials', () => {
  it.each([
    'https://api.piggyvest.business/api/v1/wallet/x',
    'https://staging.piggyvest.business.evil.example/api/v1/wallet/x',
    'http://staging.piggyvest.business/api/v1/wallet/x',
    'https://staging.piggyvest.business:8443/api/v1/wallet/x',
    'https://user:pw@staging.piggyvest.business/api/v1/wallet/x',
  ])('refuses %s before any network call', async (url) => {
    const { guarded, baseFetch } = build('live-readonly');
    expect(await refusal(() => guarded(url, { headers: AUTH }))).toBe(
      'HOST_NOT_ALLOWED'
    );
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('refuses a live key at send time even if the config was mis-wired', async () => {
    const { guarded, baseFetch } = build('live-readonly');
    expect(
      await refusal(() =>
        guarded(`${ORIGIN}/api/v1/wallet/x`, {
          headers: { Authorization: 'Bearer live_key_Nope123' },
        })
      )
    ).toBe('KEY_NOT_TEST');
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('forces redirect:error so a 3xx cannot leave the sandbox host', async () => {
    const { guarded, baseFetch } = build('live-readonly');
    await guarded(`${ORIGIN}/api/v1/wallet/x`, { headers: AUTH });
    expect(baseFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('only allows the api/v1 path space', async () => {
    const { guarded } = build('live-readonly');
    expect(
      await refusal(() => guarded(`${ORIGIN}/admin`, { headers: AUTH }))
    ).toBe('PATH_NOT_ALLOWED');
  });
});

describe('guarded fetch: run modes', () => {
  it('live-readonly allows GET and blocks every state-changing method without sending', async () => {
    const { guarded, baseFetch } = build('live-readonly');
    await guarded(`${ORIGIN}/api/v1/wallet/x`, { headers: AUTH });
    expect(baseFetch).toHaveBeenCalledTimes(1);
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      expect(
        await refusal(() =>
          guarded(`${ORIGIN}/api/v1/transfer/wallet`, {
            method,
            headers: AUTH,
            body: '{}',
          })
        )
      ).toBe('METHOD_NOT_ALLOWED');
    }
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('read-only POST is refused with MUTATION_IN_READONLY', async () => {
    const { guarded } = build('live-readonly');
    expect(
      await refusal(() =>
        guarded(`${ORIGIN}/api/v1/transfer/wallet`, {
          method: 'POST',
          headers: AUTH,
          body: '{}',
        })
      )
    ).toBe('MUTATION_IN_READONLY');
  });

  it('mutation mode refuses PATCH/PUT/DELETE and non-allowlisted POST paths', async () => {
    const { guarded, baseFetch } = build('live-sandbox-mutations');
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      expect(
        await refusal(() =>
          guarded(`${ORIGIN}/api/v1/wallet/x`, {
            method,
            headers: AUTH,
            body: '{}',
          })
        )
      ).toBe('METHOD_NOT_ALLOWED');
    }
    expect(
      await refusal(() =>
        guarded(`${ORIGIN}/api/v1/wallet/x/transaction-fee`, {
          method: 'POST',
          headers: AUTH,
          body: '{}',
        })
      )
    ).toBe('PATH_NOT_ALLOWED');
    expect(baseFetch).not.toHaveBeenCalled();
  });
});

describe('guarded fetch: request pacing', () => {
  it('spaces live requests by the minimum gap so the sandbox is not hammered', async () => {
    const slept: number[] = [];
    let clock = 1_000;
    const { guarded } = build('live-readonly', undefined, {
      minGapMs: 200,
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });
    await guarded(`${ORIGIN}/api/v1/wallet/a`, { headers: AUTH });
    clock += 50;
    await guarded(`${ORIGIN}/api/v1/wallet/b`, { headers: AUTH });
    clock += 500;
    await guarded(`${ORIGIN}/api/v1/wallet/c`, { headers: AUTH });
    expect(slept).toEqual([150]);
  });

  it('does not pace when no gap is configured (dry-run, tests)', async () => {
    const slept: number[] = [];
    const { guarded } = build('live-readonly', undefined, {
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    await guarded(`${ORIGIN}/api/v1/wallet/a`, { headers: AUTH });
    await guarded(`${ORIGIN}/api/v1/wallet/b`, { headers: AUTH });
    expect(slept).toEqual([]);
  });
});

describe('guarded fetch: unknown modes fail closed', () => {
  it('refuses POST for any mode value that is not an explicit mutation-capable mode', async () => {
    const bogus = 'toString' as unknown as Parameters<typeof build>[0];
    const { guarded, baseFetch } = build(bogus);
    expect(
      await refusal(() =>
        guarded(`${ORIGIN}/api/v1/transfer/wallet`, {
          method: 'POST',
          headers: AUTH,
          body: '{}',
        })
      )
    ).toBe('MUTATION_IN_READONLY');
    expect(baseFetch).not.toHaveBeenCalled();
  });
});
