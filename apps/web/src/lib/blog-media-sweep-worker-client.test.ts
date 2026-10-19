import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BlogMediaSweepWorkerTokenError,
  createBlogMediaSweepWorkerClient,
} from './blog-media-sweep-worker-client';

function workerToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

const VALID_ENV = {
  BLOG_MEDIA_SWEEP_WORKER_TOKEN: workerToken({
    exp: Math.floor(Date.now() / 1000) + 3600,
    role: 'blog_media_sweep_worker',
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://aivqthbxdshhltbwipbr.supabase.co',
  NODE_ENV: 'production',
};

describe('createBlogMediaSweepWorkerClient', () => {
  it('builds a client for a valid worker token on the pinned host', () => {
    const client = createBlogMediaSweepWorkerClient({ ...VALID_ENV });

    expect(typeof client.rpc).toBe('function');
    expect(typeof client.storage.from).toBe('function');
  });

  it('rejects a missing worker token', () => {
    expect(() =>
      createBlogMediaSweepWorkerClient({
        ...VALID_ENV,
        BLOG_MEDIA_SWEEP_WORKER_TOKEN: undefined,
      })
    ).toThrow(BlogMediaSweepWorkerTokenError);
  });

  it('rejects a usable non-worker JWT instead of scoping it', () => {
    expect(() =>
      createBlogMediaSweepWorkerClient({
        ...VALID_ENV,
        BLOG_MEDIA_SWEEP_WORKER_TOKEN: workerToken({
          exp: Math.floor(Date.now() / 1000) + 3600,
          role: 'service_role',
        }),
      })
    ).toThrow(BlogMediaSweepWorkerTokenError);
  });

  it('rejects an expired worker token', () => {
    expect(() =>
      createBlogMediaSweepWorkerClient({
        ...VALID_ENV,
        BLOG_MEDIA_SWEEP_WORKER_TOKEN: workerToken({
          exp: Math.floor(Date.now() / 1000) - 10,
          role: 'blog_media_sweep_worker',
        }),
      })
    ).toThrow(BlogMediaSweepWorkerTokenError);
  });

  it('rejects a plaintext Supabase URL', () => {
    expect(() =>
      createBlogMediaSweepWorkerClient({
        ...VALID_ENV,
        NEXT_PUBLIC_SUPABASE_URL: 'http://aivqthbxdshhltbwipbr.supabase.co',
      })
    ).toThrow('credential-free https:// URL');
  });

  it('rejects an unpinned host in production', () => {
    expect(() =>
      createBlogMediaSweepWorkerClient({
        ...VALID_ENV,
        BLOG_MEDIA_SWEEP_SUPABASE_ORIGIN_ALLOWLIST: 'evil.example.com',
        NEXT_PUBLIC_SUPABASE_URL: 'https://evil.example.com',
      })
    ).toThrow('not an allowed origin');
  });

  it('rejects unknown RPC names and non-media buckets', () => {
    const client = createBlogMediaSweepWorkerClient({ ...VALID_ENV });

    expect(() => client.rpc('blog_posts', {})).toThrow(
      'Unsupported blog media sweep database operation'
    );
    expect(() => client.storage.from('avatars')).toThrow(
      'Unsupported blog media sweep storage bucket'
    );
  });

  it('keeps the cleanup cron off the service-role client', () => {
    const route = readFileSync(
      join(__dirname, '../app/api/cron/cleanup-blog-media-tombstones/route.ts'),
      'utf8'
    );

    expect(route).toContain('createBlogMediaSweepWorkerClient');
    expect(route).not.toContain('createServiceClient');
    expect(route).not.toContain('event-pipeline');
  });
});
