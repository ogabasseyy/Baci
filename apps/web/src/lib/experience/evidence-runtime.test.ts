import { expect, it, vi } from 'vitest';
import { GET } from '../../app/api/integrations/chatgpt/experience-evidence/[evidenceId]/route';
import {
  getExperienceEvidenceReader,
  installExperienceEvidenceReader,
} from './evidence-runtime';

it('has no default authority, duplicate installation is rejected and stale cleanup is harmless', async () => {
  const context = {
    params: Promise.resolve({
      evidenceId: '11111111-1111-4111-8111-111111111111',
    }),
  };
  expect((await GET(new Request('http://localhost/api'), context)).status).toBe(
    503
  );
  const first = vi.fn(async () => new Response('synthetic'));
  const remove = installExperienceEvidenceReader(first);
  expect(() => installExperienceEvidenceReader(first)).toThrow();
  remove();
  const next = vi.fn(async () => new Response('synthetic'));
  const cleanup = installExperienceEvidenceReader(next);
  try {
    remove();
    expect(getExperienceEvidenceReader()).toBe(next);
    expect(
      (await GET(new Request('http://localhost/api'), context)).status
    ).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  } finally {
    cleanup();
  }
  expect(getExperienceEvidenceReader()).toBeUndefined();
});
