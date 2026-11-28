import { logger } from '@/lib/logger';
import type { TipTapNode } from './blog-tiptap-node';

export type ParsedBlogDoc =
  | { kind: 'doc'; doc: TipTapNode }
  | { kind: 'fallback' };

/**
 * Parses and validates TipTap JSON outside render so JSX is never constructed
 * inside a `try`/`catch` block.
 */
export function parseBlogDoc(json: unknown): ParsedBlogDoc {
  try {
    const doc = typeof json === 'string' ? JSON.parse(json) : json;
    if (
      doc &&
      typeof doc === 'object' &&
      (doc as { type?: unknown }).type === 'doc'
    ) {
      return { kind: 'doc', doc: doc as TipTapNode };
    }
  } catch (e) {
    logger.error({
      error: e,
      message: 'Blog renderer failed to parse document',
    });
  }
  return { kind: 'fallback' };
}
