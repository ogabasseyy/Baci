/** Test fixture only: fixed loopback TLS origin, no production credential. */
import assert from 'node:assert/strict';
import https from 'node:https';

const result = await new Promise((resolve, reject) => {
  const req = https.request(
    'https://127.0.0.1:31987/api/probe',
    {
      method: 'POST',
      rejectUnauthorized: false,
      timeout: 30000,
    },
    (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }
  );
  req.on('error', reject);
  req.on('timeout', () => req.destroy(new Error('Local fixture timed out')));
  req.end();
});
assert.equal(result.status, 200, result.body.slice(0, 500));
assert.deepEqual(JSON.parse(result.body), {
  ok: true,
  runtime: 'nodejs',
  publicationCacheCalled: true,
});
console.log(
  'PASS: fixed loopback HTTPS → real Next Node route → repository publication-cache function'
);
