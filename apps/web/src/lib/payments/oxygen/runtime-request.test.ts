// @vitest-environment node
import { expect, it } from 'vitest';
import { readOxygenRuntimeRequest } from './runtime-request';

it('rejects oversized JSON without consuming sensitive contents', async () => {
  const request = new Request('https://local', {
    method: 'POST',
    body: 'x'.repeat(70000),
    headers: { 'content-type': 'application/json' },
  });
  await expect(readOxygenRuntimeRequest(request)).rejects.toThrow(
    'Invalid workflow request'
  );
});
it('accepts a multipart image and rejects a disguised file', async () => {
  const form = new FormData();
  form.set(
    'payload',
    JSON.stringify({
      workflowId: '60000000-0000-4000-8000-000000000001',
      version: 1,
      idempotencyKey: '60000000-0000-4000-8000-000000000002',
      command: {
        action: 'submit_address',
        state: 'Lagos',
        lga: 'Ikeja',
        city: 'Ikeja',
        street: 'Street',
        landmark: 'Mall',
        house_number: '1',
      },
    })
  );
  form.set(
    'file',
    new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' }),
    'bill.jpg'
  );
  const result = await readOxygenRuntimeRequest(
    new Request('https://local', { method: 'POST', body: form })
  );
  expect(result.file?.type).toBe('image/jpeg');
  form.set('file', new Blob(['<html>'], { type: 'image/jpeg' }), 'bill.jpg');
  await expect(
    readOxygenRuntimeRequest(
      new Request('https://local', { method: 'POST', body: form })
    )
  ).rejects.toThrow();
});

it('rejects a PDF signature before enqueuing an approval command', async () => {
  const form = new FormData();
  form.set(
    'payload',
    JSON.stringify({
      workflowId: '60000000-0000-4000-8000-000000000001',
      version: 1,
      idempotencyKey: '60000000-0000-4000-8000-000000000002',
      command: { action: 'approve_booking', otp: '123456', accepted: true },
    })
  );
  form.set(
    'file',
    new Blob(['%PDF-'], { type: 'application/pdf' }),
    'signature.pdf'
  );
  await expect(
    readOxygenRuntimeRequest(
      new Request('https://local', { method: 'POST', body: form })
    )
  ).rejects.toThrow('Invalid workflow request');
});
