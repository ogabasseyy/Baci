import { describe, expect, it, vi } from 'vitest';
import { rollbackMerchantBlogPostMutation } from './rollback-merchant-blog-post-mutation';

function fakeClient(args: {
  current?: Record<string, unknown> | null;
  writeErrors?: ({ message: string } | null)[];
  writeRows?: { id: string }[];
}) {
  const writeErrors = [...(args.writeErrors ?? [])];
  const state = {
    deleted: 0,
    eqCalls: [] as [string, unknown][],
    updated: [] as Record<string, unknown>[],
  };
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    update: vi.fn(),
  };
  query.eq.mockImplementation((column: string, value: unknown) => {
    state.eqCalls.push([column, value]);
    return query;
  });
  query.select.mockImplementation((columns: string) => {
    // Guard pre-reads select many columns and end in single(); the
    // compensating write selects only the id for its affected-row check.
    if (columns !== 'id') return query;
    const error = writeErrors.length > 0 ? writeErrors.shift() : null;
    return Promise.resolve({
      data: error ? null : (args.writeRows ?? [{ id: 'post-1' }]),
      error,
    });
  });
  query.single.mockImplementation(() =>
    Promise.resolve({
      data: args.current === undefined ? null : args.current,
      error: args.current == null ? { message: 'no row' } : null,
    })
  );
  query.update.mockImplementation((value: Record<string, unknown>) => {
    state.updated.push(value);
    return query;
  });
  query.delete.mockImplementation(() => {
    state.deleted += 1;
    return query;
  });
  const client = {
    from: (table: string) => {
      if (table !== 'blog_posts') throw new Error(`unexpected ${table}`);
      return query;
    },
  } as unknown as Parameters<
    typeof rollbackMerchantBlogPostMutation
  >[0]['supabase'];
  return { client, state };
}

const SAVED_MEDIA = {
  author_image_url: null,
  content: '<p>New</p>',
  excerpt: 'New excerpt',
  featured_image_url: 'https://cdn.example.com/media/platform/blog/new.webp',
  featured_image_variants: null,
};

const CURRENT_ROW = {
  ...SAVED_MEDIA,
  updated_at: 'ts-b',
};

describe('rollbackMerchantBlogPostMutation', () => {
  it('restores the pre-save media fields on an untouched update', async () => {
    const { client, state } = fakeClient({ current: { ...CURRENT_ROW } });

    const outcome = await rollbackMerchantBlogPostMutation({
      existingPost: {
        content: '<p>Old</p>',
        excerpt: 'Old excerpt',
        title: 'Old title',
      },
      merchantId: 'merchant-1',
      mode: 'update',
      postId: 'post-1',
      savedMedia: SAVED_MEDIA,
      supabase: client,
    });

    expect(outcome).toBe('restored');
    // Only media keys present in the pre-image restore; non-media
    // fields the save wrote stay as the save left them.
    expect(state.updated).toEqual([
      { content: '<p>Old</p>', excerpt: 'Old excerpt' },
    ]);
    expect(state.eqCalls).toContainEqual(['updated_at', 'ts-b']);
  });

  it('skips the restore when an intervening update changed media', async () => {
    const { client, state } = fakeClient({
      current: { ...CURRENT_ROW, content: '<p>Bee</p>' },
    });

    const outcome = await rollbackMerchantBlogPostMutation({
      existingPost: { content: '<p>Old</p>' },
      merchantId: 'merchant-1',
      mode: 'update',
      postId: 'post-1',
      savedMedia: SAVED_MEDIA,
      supabase: client,
    });

    expect(outcome).toBe('skipped');
    expect(state.updated).toEqual([]);
  });

  it('skips the restore when the pre-image holds no media fields', async () => {
    const { client, state } = fakeClient({ current: { ...CURRENT_ROW } });

    const outcome = await rollbackMerchantBlogPostMutation({
      existingPost: { title: 'Old title' },
      merchantId: 'merchant-1',
      mode: 'update',
      postId: 'post-1',
      savedMedia: SAVED_MEDIA,
      supabase: client,
    });

    expect(outcome).toBe('skipped');
    expect(state.updated).toEqual([]);
  });

  it('retries a transient write failure before restoring', async () => {
    const { client, state } = fakeClient({
      current: { ...CURRENT_ROW },
      writeErrors: [{ message: 'flaky' }, null],
    });

    const outcome = await rollbackMerchantBlogPostMutation({
      existingPost: { content: '<p>Old</p>' },
      merchantId: 'merchant-1',
      mode: 'update',
      postId: 'post-1',
      savedMedia: SAVED_MEDIA,
      supabase: client,
    });

    expect(outcome).toBe('restored');
    expect(state.updated).toHaveLength(2);
  });

  it('gives up after repeated write failures', async () => {
    const { client, state } = fakeClient({
      current: { ...CURRENT_ROW },
      writeErrors: [
        { message: 'down' },
        { message: 'down' },
        { message: 'down' },
      ],
    });

    const outcome = await rollbackMerchantBlogPostMutation({
      existingPost: { content: '<p>Old</p>' },
      merchantId: 'merchant-1',
      mode: 'update',
      postId: 'post-1',
      savedMedia: SAVED_MEDIA,
      supabase: client,
    });

    expect(outcome).toBe('skipped');
    expect(state.updated).toHaveLength(3);
  });

  it('deletes the broken row on an untouched create', async () => {
    const { client, state } = fakeClient({ current: { ...CURRENT_ROW } });

    const outcome = await rollbackMerchantBlogPostMutation({
      merchantId: 'merchant-1',
      mode: 'create',
      postId: 'post-1',
      savedMedia: SAVED_MEDIA,
      supabase: client,
    });

    expect(outcome).toBe('deleted');
    expect(state.deleted).toBe(1);
    expect(state.eqCalls).toContainEqual(['updated_at', 'ts-b']);
  });

  it('skips the delete when another tab edited the new post', async () => {
    const { client, state } = fakeClient({
      current: { ...CURRENT_ROW, content: '<p>Bee</p>' },
    });

    const outcome = await rollbackMerchantBlogPostMutation({
      merchantId: 'merchant-1',
      mode: 'create',
      postId: 'post-1',
      savedMedia: SAVED_MEDIA,
      supabase: client,
    });

    expect(outcome).toBe('skipped');
    expect(state.deleted).toBe(0);
  });

  it('skips when the guard pre-read finds no row', async () => {
    const { client, state } = fakeClient({ current: null });

    const outcome = await rollbackMerchantBlogPostMutation({
      merchantId: 'merchant-1',
      mode: 'create',
      postId: 'post-1',
      savedMedia: SAVED_MEDIA,
      supabase: client,
    });

    expect(outcome).toBe('skipped');
    expect(state.deleted).toBe(0);
    expect(state.updated).toEqual([]);
  });

  it('skips when the re-read timestamp is missing', async () => {
    const { client, state } = fakeClient({
      current: { ...SAVED_MEDIA },
    });

    const outcome = await rollbackMerchantBlogPostMutation({
      merchantId: 'merchant-1',
      mode: 'create',
      postId: 'post-1',
      savedMedia: SAVED_MEDIA,
      supabase: client,
    });

    expect(outcome).toBe('skipped');
    expect(state.deleted).toBe(0);
  });
});
