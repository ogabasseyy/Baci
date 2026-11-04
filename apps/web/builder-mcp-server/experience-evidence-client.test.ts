// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createExperienceEvidenceClient } from './experience-evidence-client';

const id = '11111111-1111-4111-8111-111111111111';
const image = Buffer.alloc(150000);
image.set([137, 80, 78, 71, 13, 10, 26, 10]);
it('streams a >128KiB native image through only the fixed evidence endpoint', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(image, {
        headers: {
          'content-type': 'image/png',
          'content-length': String(image.length),
        },
      })
  );
  const result = await createExperienceEvidenceClient({ fetchImpl })(
    'outer.token',
    id
  );
  expect(result.type).toBe('image');
  expect(Buffer.from(result.data, 'base64')).toEqual(image);
  expect(fetchImpl).toHaveBeenCalledWith(
    `https://usebaci.com/api/integrations/chatgpt/experience-evidence/${id}`,
    expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: expect.objectContaining({ authorization: 'Bearer outer.token' }),
    })
  );
});
it('rejects wrong MIME, redirects, denied/expired authority, over-limit and truncated streams', async () => {
  for (const response of [
    new Response(image, {
      headers: {
        'content-type': 'text/html',
        'content-length': String(image.length),
      },
    }),
    new Response(null, {
      status: 302,
      headers: { location: 'https://evil.test' },
    }),
    new Response(null, { status: 403 }),
    new Response(null, { status: 410 }),
    new Response(image, {
      headers: { 'content-type': 'image/png', 'content-length': '2097153' },
    }),
    new Response(image, {
      headers: { 'content-type': 'image/png', 'content-length': '150001' },
    }),
    new Response(image, {
      headers: { 'content-type': 'image/png', 'content-length': '149999' },
    }),
    new Response('invalid', {
      headers: { 'content-type': 'image/png', 'content-length': '7' },
    }),
  ])
    await expect(
      createExperienceEvidenceClient({
        fetchImpl: vi.fn(async () => response),
      })('outer.token', id)
    ).rejects.toThrow('EVIDENCE_UNAVAILABLE');
});
it('does not fetch a caller-selected URL, malformed token or evidence path', async () => {
  const fetchImpl = vi.fn();
  const read = createExperienceEvidenceClient({ fetchImpl });
  for (const [token, path] of [
    ['outer.token', 'https://evil.test/a'],
    ['secret\r\nleak', id],
    ['outer.token', `${id}/../source`],
  ])
    await expect(read(token, path)).rejects.toThrow('INVALID_REQUEST');
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('uses only the trusted staging origin while retaining its fixed evidence path', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(image, {
        headers: {
          'content-type': 'image/png',
          'content-length': String(image.length),
        },
      })
  );
  await createExperienceEvidenceClient({
    backendOrigin: 'https://staging.example.test',
    fetchImpl,
  })('outer.token', id);
  expect(fetchImpl).toHaveBeenCalledWith(
    `https://staging.example.test/api/integrations/chatgpt/experience-evidence/${id}`,
    expect.anything()
  );
  for (const backendOrigin of [
    'https://user:pass@staging.example.test',
    'https://staging.example.test/other',
    'http://staging.example.test',
  ])
    expect(() =>
      createExperienceEvidenceClient({ backendOrigin, fetchImpl })
    ).toThrow('INVALID_BACKEND_ORIGIN');
});
