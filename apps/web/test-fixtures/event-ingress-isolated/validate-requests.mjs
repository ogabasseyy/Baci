import assert from 'node:assert/strict';

export async function validateRequests({ alphaHost, beta, event, post }) {
  const rejected = [
    [
      'merchant mismatch',
      event('mismatch', { merchant_id: beta }),
      alphaHost,
      {},
      403,
      { code: 'merchant_mismatch', error: 'Failed to resolve event context' },
    ],
    [
      'unverified custom domain',
      event('unverified'),
      'route-unverified.invalid',
      {},
      403,
      { error: 'Unverified merchant context' },
    ],
    [
      'foreign page path',
      event('foreign-page', { page_url: 'https://other.invalid/route-alpha' }),
      'route-baci.invalid',
      {},
      403,
      { error: 'Unverified merchant context' },
    ],
    [
      'origin is not tenant authority',
      event('origin'),
      'route-baci.invalid',
      { origin: `https://${alphaHost}` },
      403,
      { error: 'Unverified merchant context' },
    ],
    ['malformed JSON', '{', alphaHost, {}, 400, { error: 'Invalid JSON' }],
    [
      'oversized JSON',
      JSON.stringify(
        event('oversize', { custom_data: { oversized: 'x'.repeat(65_536) } })
      ),
      alphaHost,
      {},
      413,
      { error: 'Event payload too large' },
    ],
    [
      'missing required event',
      event('missing-type', { event_type: undefined }),
      alphaHost,
      {},
      400,
      { error: 'Missing required fields: event_type and merchant_id' },
    ],
    [
      'invalid schema',
      event('invalid', { event_type: 'bad type' }),
      alphaHost,
      {},
      400,
      { code: 'invalid_input', error: 'Invalid input' },
    ],
    [
      'stale timestamp',
      event('stale', { timestamp: '2000-01-01T00:00:00.000Z' }),
      alphaHost,
      {},
      400,
      { error: 'Event timestamp outside allowed window' },
    ],
    [
      'future timestamp',
      event('future', {
        timestamp: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      alphaHost,
      {},
      400,
      { error: 'Event timestamp outside allowed window' },
    ],
  ];
  for (const [label, payload, host, headers, code, response] of rejected) {
    assert.deepEqual(
      await post(payload, host, headers),
      [code, response],
      label
    );
    console.log(`PASS ${label}`);
  }
}
