// Run against a local production build with an authenticated dashboard cookie.
import assert from 'node:assert/strict';

const target = process.argv[2];
assert.ok(
  target && URL.canParse(target),
  'Usage: node tools/qa/check-dashboard-csp.mjs <local-dashboard-url>'
);
const url = new URL(target);
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
  'Use a loopback URL so the local session cookie stays on this machine'
);

async function checkDocument() {
  const response = await fetch(url, {
    headers: process.env.BACI_LOCAL_DASHBOARD_COOKIE
      ? { cookie: process.env.BACI_LOCAL_DASHBOARD_COOKIE }
      : undefined,
    redirect: 'manual',
  });
  assert.ok(
    !(response.status >= 300 && response.status < 400) &&
      response.status !== 401 &&
      response.status !== 403,
    'Dashboard access failed. Check that the local session cookie is valid.'
  );
  assert.equal(response.status, 200, 'Expected a dashboard HTML response');
  const nonce = response.headers
    .get('content-security-policy')
    ?.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, 'The response must send a CSP nonce');

  const html = await response.text();
  assert.match(
    html,
    /<h1\b[^>]*>\s*Discount Codes\b[^<]*<\/h1>/i,
    'Expected the Discount Codes dashboard heading in the HTML response'
  );
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gi)].map(
    ([, attributes]) => attributes
  );
  const bootstrap = scriptTags.filter(
    (attributes) =>
      !/\bsrc\s*=|\btype\s*=\s*["']application\/(?:json|ld\+json)["\x27]/i.test(
        attributes
      )
  );
  assert.ok(bootstrap.length, 'Expected inline Next.js bootstrap scripts');
  for (const attributes of bootstrap) {
    assert.ok(
      attributes.includes(`nonce="${nonce}"`),
      'An inline bootstrap script is missing the current response nonce'
    );
  }
  return nonce;
}

const first = await checkDocument();
assert.notEqual(await checkDocument(), first, 'Each request needs a new nonce');
process.stdout.write('Both dashboard responses have matching, fresh nonces.\n');
