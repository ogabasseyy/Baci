import { describe, expect, it } from 'vitest';
import { getBlogPostTextPreview } from '@/lib/blog-utils';

describe('getBlogPostTextPreview', () => {
  it('extracts plain text from TipTap JSON strings', () => {
    const preview = getBlogPostTextPreview(
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello structured blog world' }],
          },
        ],
      })
    );

    expect(preview).toBe('Hello structured blog world');
  });

  it('strips HTML and truncates previews', () => {
    const preview = getBlogPostTextPreview(
      '<p>Choose the right phone for your budget today.</p>',
      20
    );

    expect(preview).toBe('Choose the right...');
  });

  it('falls back safely when content is not extractable', () => {
    const preview = getBlogPostTextPreview({ foo: 'bar' });

    expect(preview).toBe('Read this blog post');
  });

  it('uses a custom fallback when content is not extractable', () => {
    const preview = getBlogPostTextPreview({ foo: 'bar' }, 160, 'Keep reading');

    expect(preview).toBe('Keep reading');
  });

  it('treats malformed JSON strings as plain text', () => {
    const preview = getBlogPostTextPreview('{bad: json');

    expect(preview).toBe('{bad: json');
  });

  it('falls back for empty strings and nullish content', () => {
    expect(getBlogPostTextPreview('')).toBe('Read this blog post');
    expect(getBlogPostTextPreview(null)).toBe('Read this blog post');
    expect(getBlogPostTextPreview(undefined)).toBe('Read this blog post');
  });

  it('does not truncate text that equals the max length', () => {
    const preview = getBlogPostTextPreview('<p>Exactly sixteen!</p>', 16);

    expect(preview).toBe('Exactly sixteen!');
  });

  it('concatenates multi-paragraph TipTap JSON payloads', () => {
    const preview = getBlogPostTextPreview(
      JSON.stringify({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second.' }] },
        ],
      })
    );

    expect(preview).toBe('First. Second.');
  });

  it('extracts plain text from formatted TipTap marks', () => {
    const preview = getBlogPostTextPreview(
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Bold text', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' and a link', marks: [{ type: 'link' }] },
            ],
          },
        ],
      })
    );

    expect(preview).toBe('Bold text and a link');
  });
});
