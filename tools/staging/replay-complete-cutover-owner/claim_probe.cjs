const fs = require('node:fs');

const profiles = ['oldNative', 'oldInterest', 'new'];
const endpoint = 'http://pvb-staging-receipts-rest:3000/rpc/';

function requireCondition(condition) {
  if (!condition) throw new Error('claim_fence_probe_refused');
}

async function probe(tokens, request = fetch) {
  requireCondition(
    tokens &&
      Object.keys(tokens).sort().join(',') === [...profiles].sort().join(',')
  );
  const results = {};
  for (const profile of profiles) {
    const token = tokens[profile];
    requireCondition(
      typeof token === 'string' && token.length > 0 && token.length <= 8192
    );
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const identity = await request(`${endpoint}piggyvest_staging_system_id`, {
      method: 'POST',
      headers,
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
    });
    const identityRaw = await identity.text();
    requireCondition(
      identity.status === 200 &&
        identityRaw.length <= 128 &&
        JSON.parse(identityRaw) === '7686901100561231906'
    );
    const response = await request(
      `${endpoint}claim_piggyvest_staging_receipts`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_limit: null, p_lease_seconds: null }),
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
      }
    );
    const raw = await response.text();
    requireCondition(raw.length <= 8192 && !raw.includes('\\'));
    const keys = [...raw.matchAll(/"(code|message|details|hint)"\s*:/g)].map(
      (match) => match[1]
    );
    requireCondition(keys.sort().join(',') === 'code,details,hint,message');
    const body = JSON.parse(raw);
    const expected =
      profile === 'new'
        ? { status: 400, code: '22023', message: 'Invalid claim bounds' }
        : { status: 403, code: '42501', message: 'Replay claimant refused' };
    requireCondition(
      response.status === expected.status &&
        Object.keys(body).sort().join(',') === 'code,details,hint,message' &&
        body.code === expected.code &&
        body.message === expected.message &&
        body.details === null &&
        body.hint === null
    );
    results[profile] = {
      identity: '7686901100561231906',
      status: expected.status,
      body: raw,
    };
  }
  return results;
}

module.exports = probe;

if (require.main === module) {
  Promise.resolve()
    .then(() =>
      probe(JSON.parse(fs.readFileSync('/probe/tokens.json', 'utf8')))
    )
    .then((results) => process.stdout.write(`${JSON.stringify(results)}\n`))
    .catch(() => {
      process.stdout.write(
        '{"status":"claim-fence-probe-refused","redacted":true}\n'
      );
      process.exitCode = 1;
    });
}
