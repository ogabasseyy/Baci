import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { docsWalletTransferEnvelope } from './provider-transfer-docs.test-support';
import {
  readProviderTransfer,
  readProviderTransferFailure,
  readTransferEnvelopeReferences,
} from './provider-transfer-reader';
import {
  readerCollection as collection,
  readerExpected as expected,
  readerLiveRecord as live,
  readerMain as main,
  readerReference as reference,
} from './provider-transfer-reader.test-support';
import {
  jsonResponse,
  liveJustSubmittedNotFound,
  liveUnknownReferenceNotFound,
} from './transaction-status-live.test-support';
import { outflowReferenceCandidates } from './transfer-outbox';

function providerAnswering(...responses: Array<() => Promise<Response>>) {
  const queue = [...responses];
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error('No more provider answers');
    return await next();
  });
}

function readWith(
  fetchImplementation: typeof fetch,
  environment: 'staging' | 'production' = 'staging'
) {
  return readProviderTransfer({
    reference,
    expected,
    transport: { environment, token: 'synthetic-token', fetchImplementation },
  });
}

describe('readProviderTransfer request', () => {
  it('sends one GET to the TSQ for our reference, narrowed to the source wallet', async () => {
    const fetchImplementation = providerAnswering(async () =>
      jsonResponse(live('successful'))
    );
    await expect(readWith(fetchImplementation)).resolves.toMatchObject({
      outcome: 'submitted',
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `https://staging.piggyvest.business/api/v1/transaction/verify?reference=${encodeURIComponent(reference)}&wallet_id=${main.walletId}`
    );
    expect(init).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer synthetic-token' },
    });
  });

  it('uses the production origin for production', async () => {
    const fetchImplementation = providerAnswering(async () =>
      jsonResponse(live('pending'))
    );
    await readWith(fetchImplementation, 'production');
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/api\.piggyvest\.business\/api\/v1\/transaction\/verify\?/
    );
  });

  it.each([
    ['an unknown reference', liveUnknownReferenceNotFound],
    ['a just-submitted reference', liveJustSubmittedNotFound],
  ])('reads the 404 for %s as not found and sends nothing else', async (_label, body) => {
    const fetchImplementation = providerAnswering(async () =>
      jsonResponse(body, 404)
    );
    await expect(readWith(fetchImplementation)).resolves.toEqual({
      outcome: 'not_found',
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    for (const [, init] of fetchImplementation.mock.calls)
      expect(init?.method).toBe('GET');
  });

  it("follows #3896's live sequence: 404, then pending, then successful", async () => {
    const fetchImplementation = providerAnswering(
      async () => jsonResponse(liveJustSubmittedNotFound, 404),
      async () => jsonResponse(live('pending')),
      async () => jsonResponse(live('successful'))
    );
    const outcomes: string[] = [];
    for (let poll = 0; poll < 3; poll += 1)
      outcomes.push((await readWith(fetchImplementation)).outcome);
    expect(outcomes).toEqual(['not_found', 'pending', 'submitted']);
  });

  it.each([
    ['an HTTP 500', async () => jsonResponse({ status: false }, 500)],
    ['an HTTP 429', async () => jsonResponse({ status: false }, 429)],
    [
      'a transport failure',
      async (): Promise<Response> => {
        throw new TypeError('fetch failed');
      },
    ],
    [
      'an oversized body',
      async () =>
        jsonResponse({ ...live('successful'), padding: 'x'.repeat(70000) }),
    ],
  ])('keeps %s uncertain', async (_label, answer) => {
    await expect(readWith(providerAnswering(answer))).resolves.toEqual({
      outcome: 'uncertain',
      reason: 'provider_error',
    });
  });

  it('aborts the request when the body passes the byte cap', async () => {
    let signal: AbortSignal | undefined;
    const fetchImplementation = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return jsonResponse({ padding: 'x'.repeat(70000) });
      }
    );
    await readWith(fetchImplementation);
    expect(signal?.aborted).toBe(true);
  });

  it('never calls the provider for an invalid expectation', async () => {
    const fetchImplementation = providerAnswering();
    await expect(
      readProviderTransfer({
        reference,
        expected: { ...expected, destination: { ...main } },
        transport: {
          environment: 'staging',
          token: 'synthetic-token',
          fetchImplementation,
        },
      })
    ).resolves.toEqual({ outcome: 'uncertain', reason: 'expectation_invalid' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('wallet-transfer webhook attribution', () => {
  const savingsReference = 'pvb-save-00000000-0000-4000-8000-000000000002';
  const docs = (ours: string) =>
    docsWalletTransferEnvelope({
      reference: ours,
      amountKobo: expected.amountKobo,
      sourceWalletId: main.walletId,
      destinationWalletId: collection.walletId,
    });

  it('reads the envelope pvb_third_party_reference first', () => {
    const envelope = docs(savingsReference);
    const candidates = readTransferEnvelopeReferences(envelope);
    expect(candidates[0]).toBe(savingsReference);
    // Regression: the eventData-only candidates never held our reference.
    expect(outflowReferenceCandidates(envelope.eventData)).not.toContain(
      savingsReference
    );
    expect(candidates).toEqual([
      savingsReference,
      ...outflowReferenceCandidates(envelope.eventData).filter(
        (value, index, all) => all.indexOf(value) === index
      ),
    ]);
  });

  it('matches an attempt reference carried only on the envelope', () => {
    expect(readTransferEnvelopeReferences(docs(reference))).toContain(
      reference
    );
  });

  it('falls back to the event details when the envelope carries none', () => {
    const envelope = { ...docs(reference), pvb_third_party_reference: null };
    expect(readTransferEnvelopeReferences(envelope)).not.toContain(reference);
    expect(readTransferEnvelopeReferences(envelope)[0]).toBe(
      envelope.eventData.reference
    );
  });

  it.each([
    ['another event type', { eventType: 'bank-transfer.outflow.success' }],
    ['another category', { eventCategory: 'wallet-transfer' }],
    [
      'non-p2p details',
      { eventData: { ...docs(reference).eventData, category: 'bank-inflow' } },
    ],
  ])('attributes nothing for %s', (_label, change) => {
    expect(
      readTransferEnvelopeReferences({ ...docs(reference), ...change })
    ).toEqual([]);
  });

  it('attributes nothing for a non-envelope', () => {
    for (const value of [null, 'text', 42, {}])
      expect(readTransferEnvelopeReferences(value)).toEqual([]);
  });
});

describe('provider transfer reader: failed requests', () => {
  it('reads only an HTTP 404 as not found, carrying nothing that moves money', () => {
    const notFound = readProviderTransferFailure(
      Object.assign(new Error('PROVIDER_HTTP_ERROR'), { httpStatus: 404 })
    );
    expect(notFound).toEqual({ outcome: 'not_found' });
    expect('transfer' in notFound).toBe(false);
    expect(
      readProviderTransferFailure(
        new PiggyvestApiError(
          'PIGGYVEST_REQUEST_ERROR',
          'Transaction Not Found',
          404,
          true
        )
      )
    ).toEqual({ outcome: 'not_found' });
  });

  it.each([
    Object.assign(new Error('PROVIDER_HTTP_ERROR'), { httpStatus: 500 }),
    new Error('PROVIDER_TIMEOUT'),
    new Error('PROVIDER_RESPONSE_TOO_LARGE'),
    { httpStatus: 404 },
    undefined,
  ])('keeps %j uncertain', (error) => {
    expect(readProviderTransferFailure(error)).toEqual({
      outcome: 'uncertain',
      reason: 'provider_error',
    });
  });
});
