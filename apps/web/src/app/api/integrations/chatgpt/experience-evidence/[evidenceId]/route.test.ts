import { expect, it, vi } from 'vitest';
import { installExperienceEvidenceReader } from '@/lib/experience/evidence-runtime';
import { GET } from './route';

it('uninstalled evidence is private 503; installed reader owns authentication and binary delivery', async () => {
  const request = new Request('http://127.0.0.1/evidence');
  const params = {
    params: Promise.resolve({ evidenceId: 'synthetic-evidence' }),
  };
  const absent = await GET(request, params);
  expect(absent.status).toBe(503);
  expect(absent.headers.get('cache-control')).toBe('private, no-store');
  const reader = vi.fn(
    async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'private, no-store',
        },
      })
  );
  const cleanup = installExperienceEvidenceReader(reader);
  try {
    const result = await GET(request, params);
    expect(result.headers.get('content-type')).toBe('image/png');
    expect(reader).toHaveBeenCalledWith(request, 'synthetic-evidence');
  } finally {
    cleanup();
  }
  expect((await GET(request, params)).status).toBe(503);
});
