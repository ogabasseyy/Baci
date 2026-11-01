import { describe, expect, it } from 'vitest';
import { resolveBlogAuthorIdentity } from './resolve-blog-author-identity';

describe('resolveBlogAuthorIdentity', () => {
  it('returns null profile fields when no posts are present on the page', () => {
    expect(resolveBlogAuthorIdentity('Bassey John', [])).toEqual({
      name: 'Bassey John',
      title: null,
      bio: null,
      imageUrl: null,
    });
  });

  it('falls back past posts with missing or blank author E-E-A-T fields', () => {
    const posts = [
      {
        author_title: null,
        author_bio: '   ',
        author_image_url: null,
      },
      {
        author_title: 'Performance Marketing Specialist',
        author_bio: 'Writes data-driven gadget buying guides.',
        author_image_url:
          'https://cdn.ogabassey.com/merchants/ogabassey/authors/bassey-john.jpg',
      },
    ];

    expect(resolveBlogAuthorIdentity('Bassey John', posts)).toEqual({
      name: 'Bassey John',
      title: 'Performance Marketing Specialist',
      bio: 'Writes data-driven gadget buying guides.',
      imageUrl:
        'https://cdn.ogabassey.com/merchants/ogabassey/authors/bassey-john.jpg',
    });
  });

  it('merges the first non-empty value per field across posts in the window', () => {
    const posts = [
      {
        author_title: 'Performance Marketing Specialist',
        author_bio: null,
        author_image_url: null,
      },
      {
        author_title: 'Legacy Role',
        author_bio: 'Writes data-driven gadget buying guides.',
        author_image_url:
          'https://cdn.ogabassey.com/merchants/ogabassey/authors/bassey-john.jpg',
      },
      {
        author_title: 'Older Title',
        author_bio: 'Older bio text.',
        author_image_url:
          'https://cdn.ogabassey.com/merchants/ogabassey/authors/older.jpg',
      },
    ];

    expect(resolveBlogAuthorIdentity('Bassey John', posts)).toEqual({
      name: 'Bassey John',
      title: 'Performance Marketing Specialist',
      bio: 'Writes data-driven gadget buying guides.',
      imageUrl:
        'https://cdn.ogabassey.com/merchants/ogabassey/authors/bassey-john.jpg',
    });
  });
});
