import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET, POST } from './route';

const CSRF_HEADERS = {
  Cookie: 'csrf-token=test-csrf-token',
  'x-csrf-token': 'test-csrf-token',
};

describe('/api/payments/verify method boundary', () => {
  it('serves sessionless verification over GET, gated by the creation tracking token', async () => {
    const missing = await GET(
      new NextRequest('http://localhost:3000/api/payments/verify')
    );
    expect(missing.status).toBe(400);

    // A reference alone proves nothing: without the tracking token the
    // read-only entry refuses, so forged navigations cannot probe order
    // state by reference.
    const unproven = await GET(
      new NextRequest(
        'http://localhost:3000/api/payments/verify?reference=txn-ref-123'
      )
    );
    const body = await unproven.json();

    expect(unproven.status).toBe(400);
    expect(body.error).toContain('tracking token');
  });

  it('requires a JSON POST body before validating a reference', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/payments/verify', {
        body: 'reference=txn-ref-123',
        headers: { ...CSRF_HEADERS, 'Content-Type': 'text/plain' },
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(415);
    expect(body.error).toBe('Expected application/json request body');
  });

  it('rejects malformed JSON before any reconciliation work can run', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/payments/verify', {
        body: '{not-json',
        headers: { ...CSRF_HEADERS, 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid JSON body');
  });

  it('validates the JSON reference field before loading payment state', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/payments/verify', {
        body: JSON.stringify({ reference: '' }),
        headers: { ...CSRF_HEADERS, 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid reference');
  });

  it('rejects POST requests that fail CSRF validation before body parsing', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/payments/verify', {
        body: JSON.stringify({ reference: 'txn-ref-123' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Invalid CSRF token');
  });
});
