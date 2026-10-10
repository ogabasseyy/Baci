import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { parseBlogPostMutationBody } from './blog-post-mutation-body';

describe('parseBlogPostMutationBody', () => {
  it('returns a JSON object body for a valid blog post mutation', async () => {
    const request = new NextRequest('https://baci.test/blog-posts', {
      body: JSON.stringify({ title: 'A post', status: 'draft' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    await expect(parseBlogPostMutationBody(request)).resolves.toEqual({
      body: { title: 'A post', status: 'draft' },
      error: null,
    });
  });

  it('rejects malformed JSON instead of allowing the route to treat it as an internal error', async () => {
    const request = new NextRequest('https://baci.test/blog-posts', {
      body: '{',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    await expect(parseBlogPostMutationBody(request)).resolves.toEqual({
      body: null,
      error: 'Invalid JSON body',
    });
  });

  it('strips platform intent taxonomy from merchant mutation bodies', async () => {
    const request = new NextRequest('https://baci.test/blog-posts', {
      body: JSON.stringify({
        focus_keyword: 'kept',
        intent: 'comparison',
        intent_source: 'draft_task_type',
        title: 'A post',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    await expect(parseBlogPostMutationBody(request)).resolves.toEqual({
      body: { focus_keyword: 'kept', title: 'A post' },
      error: null,
    });
  });

  it('rejects array JSON because blog post fields must be keyed', async () => {
    const request = new NextRequest('https://baci.test/blog-posts', {
      body: JSON.stringify(['title', 'content']),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    await expect(parseBlogPostMutationBody(request)).resolves.toEqual({
      body: null,
      error: 'Invalid JSON body',
    });
  });
});
