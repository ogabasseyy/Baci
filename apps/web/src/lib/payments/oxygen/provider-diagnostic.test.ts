import { expect, it } from 'vitest';
import { readOxygenFailureDiagnostic } from './provider-diagnostic';

it('retains the current provider rejection and status while removing private payload data', async () => {
  const result = await readOxygenFailureDiagnostic(
    Response.json(
      {
        message:
          'Invalid statement for Ada Example ada@example.test 0123456789. Bearer private-token https://verify.test/?token=private',
        response_code: 'STATEMENT_REQUIRED',
        extra: { bvn: '12345678901' },
      },
      {
        status: 400,
        headers: {
          'x-request-id': '12345678-abcd-1234-abcd-123456789abc',
          authorization: 'private',
        },
      }
    ),
    'book',
    { first_name: 'Ada', last_name: 'Example', account_number: '0123456789' },
    ['private-token'],
    Date.now()
  );
  expect(result.httpStatus).toBe(400);
  expect(result.providerCode).toBe('STATEMENT_REQUIRED');
  expect(result.providerRequestId).toBe('12345678-abcd-1234-abcd-123456789abc');
  expect(result.providerMessage).toContain('Invalid statement');
  const text = JSON.stringify(result);
  for (const value of [
    'Ada',
    'Example',
    'ada@',
    '0123456789',
    'private-token',
    '12345678901',
    'verify.test',
    'authorization',
  ])
    expect(text).not.toContain(value);
});
it('preserves an exact non-sensitive provider error from this response', async () => {
  const message =
    'User does not have a valid statement and user has option to add another bank';
  const result = await readOxygenFailureDiagnostic(
    Response.json({ message }, { status: 400 }),
    'book',
    {},
    [],
    Date.now()
  );
  expect(result.providerMessage).toBe(message);
});
it('bounds bodies and does not store non-JSON payloads', async () => {
  const oversized = await readOxygenFailureDiagnostic(
    new Response('x'.repeat(17000), { status: 502 }),
    'book',
    {},
    [],
    Date.now()
  );
  expect(oversized.capture).toBe('oversized');
  expect(oversized.outcome).toBe('indeterminate');
  const html = await readOxygenFailureDiagnostic(
    new Response('<html>private data</html>', { status: 400 }),
    'book',
    {},
    [],
    Date.now()
  );
  expect(html.capture).toBe('non_json');
  expect(html.providerMessage).toBeNull();
});
it('ignores credential-shaped correlation headers and sanitizes multipart fields', async () => {
  const form = new FormData();
  form.set('phone_number', '2348000000000');
  form.set('name', 'Ada Buyer');
  const result = await readOxygenFailureDiagnostic(
    Response.json(
      { message: 'Ada Buyer 2348000000000 token=secret' },
      {
        status: 400,
        headers: { 'x-request-id': 'eyJtoken.eyJpayload.signature' },
      }
    ),
    'address',
    form,
    [],
    Date.now()
  );
  expect(result.providerRequestId).toBeNull();
  expect(result.providerMessage).not.toMatch(/Ada|Buyer|234800|secret/);
});

it('preserves short provider response codes but scrubs quoted credentials in messages', async () => {
  const result = await readOxygenFailureDiagnostic(
    Response.json(
      {
        message:
          'Request failed {"token":"unrecognized-secret","password":"private-pass"}',
        response_code: '99',
      },
      { status: 400 }
    ),
    'eligibility',
    {},
    [],
    Date.now()
  );
  expect(result.providerCode).toBe('99');
  expect(result.providerMessage).not.toMatch(
    /unrecognized-secret|private-pass/
  );
});
it('does not retain a document/signature blob echoed into an error message', async () => {
  const blob = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(20);
  const result = await readOxygenFailureDiagnostic(
    Response.json({ message: `Invalid signature ${blob}` }, { status: 400 }),
    'approve',
    {},
    [],
    Date.now()
  );
  expect(result.providerMessage).toBe('Invalid signature [redacted]');
});
it('redacts short names as words without corrupting unrelated words', async () => {
  const result = await readOxygenFailureDiagnostic(
    Response.json({ message: 'Li has a valid statement' }, { status: 400 }),
    'create',
    { customer: { first_name: 'Li' } },
    [],
    Date.now()
  );
  expect(result.providerMessage).toBe('[redacted] has a valid statement');
});
