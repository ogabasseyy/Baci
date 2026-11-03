import { describe, expect, it } from 'vitest';
import {
  AUTH,
  build,
  ORIGIN,
  refusal,
  walletTransfer,
} from './guarded-fetch.test-support';

describe('guarded fetch: mutations need a journaled intent', () => {
  it('refuses a POST with no intent', async () => {
    const { guarded, baseFetch } = build('live-sandbox-mutations');
    expect(
      await refusal(() =>
        guarded(`${ORIGIN}/api/v1/transfer/wallet`, {
          method: 'POST',
          headers: AUTH,
          body: '{}',
        })
      )
    ).toBe('MUTATION_WITHOUT_INTENT');
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('journals the intent BEFORE the request leaves', async () => {
    const { guarded, gate, journal, baseFetch } = build(
      'live-sandbox-mutations'
    );
    const begun = gate.begin(walletTransfer);
    if (begun.kind !== 'send') throw new Error('expected send');
    let journaledWhenSent = -1;
    baseFetch.mockImplementationOnce(async () => {
      journaledWhenSent = journal.entries().length;
      return new Response(
        JSON.stringify({ status: true, message: 'processing' }),
        { status: 202 }
      );
    });
    await guarded(`${ORIGIN}/api/v1/transfer/wallet`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        ...walletTransfer.bodyMatch,
        currency: 'NGN',
        reference: begun.reference,
      }),
    });
    expect(journaledWhenSent).toBe(1);
  });

  it('sends a matching request once and refuses a blind second send', async () => {
    const { guarded, gate, baseFetch } = build('live-sandbox-mutations');
    const begun = gate.begin(walletTransfer);
    if (begun.kind !== 'send') throw new Error('expected send');
    const body = JSON.stringify({
      ...walletTransfer.bodyMatch,
      reference: begun.reference,
    });
    const init = { method: 'POST', headers: AUTH, body };
    await guarded(`${ORIGIN}/api/v1/transfer/wallet`, init);
    expect(
      await refusal(() => guarded(`${ORIGIN}/api/v1/transfer/wallet`, init))
    ).toBe('MUTATION_WITHOUT_INTENT');
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a request whose body deviates from the journaled intent', async () => {
    const { guarded, gate, baseFetch } = build('live-sandbox-mutations');
    const begun = gate.begin(walletTransfer);
    if (begun.kind !== 'send') throw new Error('expected send');
    expect(
      await refusal(() =>
        guarded(`${ORIGIN}/api/v1/transfer/wallet`, {
          method: 'POST',
          headers: AUTH,
          body: JSON.stringify({
            ...walletTransfer.bodyMatch,
            amount: 999999,
            reference: begun.reference,
          }),
        })
      )
    ).toBe('MUTATION_MISMATCH');
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('remembers the refusal even if the caller swallows it', async () => {
    const { guarded, capture } = build('live-readonly');
    await refusal(() =>
      guarded('https://api.piggyvest.business/x', { headers: AUTH })
    );
    expect(capture.take().refusal?.code).toBe('HOST_NOT_ALLOWED');
  });
});

describe('guarded fetch: recording account and capture', () => {
  it('refuses a request URL that references the recording account', async () => {
    const { guarded, baseFetch } = build('live-readonly');
    expect(
      await refusal(() =>
        guarded(
          `${ORIGIN}/api/v1/customers?email=baci-recording-20261013%40example.com`,
          { headers: AUTH }
        )
      )
    ).toBe('RECORDING_ACCOUNT');
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('discards a response that mentions the recording account', async () => {
    const { guarded, capture } = build(
      'live-readonly',
      () =>
        new Response(
          JSON.stringify({
            status: true,
            message: 'ok',
            data: [{ email: 'baci-recording-20261013@example.com' }],
          }),
          { status: 200 }
        )
    );
    expect(
      await refusal(() =>
        guarded(`${ORIGIN}/api/v1/customers`, { headers: AUTH })
      )
    ).toBe('RECORDING_ACCOUNT');
    expect(capture.take().response).toBeNull();
  });

  it('returns a readable response and captures status plus parsed envelope', async () => {
    const { guarded, capture } = build(
      'live-readonly',
      () =>
        new Response(
          JSON.stringify({ status: false, message: 'Transaction not found' }),
          { status: 404 }
        )
    );
    const response = await guarded(
      `${ORIGIN}/api/v1/transaction/verify?reference=r`,
      { headers: AUTH }
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ status: false });
    const seen = capture.take().response;
    expect(seen).toMatchObject({
      method: 'GET',
      pathname: '/api/v1/transaction/verify',
      httpStatus: 404,
      envelope: { status: false, message: 'Transaction not found' },
    });
  });

  it('captures a null envelope for non-JSON bodies', async () => {
    const { guarded, capture } = build(
      'live-readonly',
      () => new Response('<html>', { status: 502 })
    );
    await guarded(`${ORIGIN}/api/v1/wallet/x`, { headers: AUTH });
    expect(capture.take().response).toMatchObject({
      httpStatus: 502,
      envelope: null,
    });
  });
});
