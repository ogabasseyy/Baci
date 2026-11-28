import { describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { parseBlogDoc } from './parse-blog-doc';

describe('parseBlogDoc', () => {
  it('parses a valid TipTap doc object', () => {
    const doc = { type: 'doc', content: [] };
    expect(parseBlogDoc(doc)).toEqual({ kind: 'doc', doc });
  });

  it('parses a serialized JSON TipTap doc string', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(parseBlogDoc(JSON.stringify(doc))).toEqual({ kind: 'doc', doc });
  });

  it('returns fallback for non-doc objects without logging an error', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    expect(parseBlogDoc({ type: 'paragraph' })).toEqual({ kind: 'fallback' });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('logs and returns fallback when JSON.parse throws on legacy HTML', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    expect(parseBlogDoc('<p>Legacy HTML</p>')).toEqual({ kind: 'fallback' });
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
