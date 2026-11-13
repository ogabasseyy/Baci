import { describe, expect, it } from 'vitest';
import { generateBlogPostSchema } from './blog-post-schema';

describe('generateBlogPostSchema', () => {
  const baseInput = {
    title: 'Editorial Phone Guide',
    description: 'How to pick the right phone.',
    url: 'https://ogabassey.com/blog/editorial-phone-guide',
    datePublished: '2026-11-09T13:00:00.000Z',
    publisher: {
      id: 'https://ogabassey.com#organization',
      name: 'Ogabassey',
      logo: 'https://ogabassey.com/logo.png',
      url: 'https://ogabassey.com',
    },
  };

  it('emits Organization author and omits jobTitle when author type is Organization', () => {
    const schema = generateBlogPostSchema({
      ...baseInput,
      author: {
        type: 'Organization',
        id: 'https://ogabassey.com#organization',
        name: 'Ogabassey',
        url: 'https://ogabassey.com',
        jobTitle: 'Editorial Desk',
      },
    });

    expect(schema.author).toEqual({
      '@type': 'Organization',
      '@id': 'https://ogabassey.com#organization',
      name: 'Ogabassey',
      url: 'https://ogabassey.com',
    });
  });

  it('defaults to Person author and preserves jobTitle when type is omitted', () => {
    const schema = generateBlogPostSchema({
      ...baseInput,
      author: {
        name: 'Jane Doe',
        url: 'https://ogabassey.com/blog/author/jane-doe',
        jobTitle: 'Senior Editor',
      },
    });

    expect(schema.author).toEqual({
      '@type': 'Person',
      '@id': 'https://ogabassey.com/blog/author/jane-doe#author-jane-doe',
      name: 'Jane Doe',
      url: 'https://ogabassey.com/blog/author/jane-doe',
      jobTitle: 'Senior Editor',
    });
  });
});
