/**
 * Blog utility functions for content processing.
 *
 * Extracted from API routes to enable reuse and independent testing.
 * Used by: blog posts API, blog [id] API, RSS feed route.
 */

/** Calculate word count from HTML or plain text content. */
export function calculateWordCount(content: string): number {
  if (!content) return 0;
  const textOnly = content.replace(/<[^>]*>/g, ' ');
  return textOnly.split(/\s+/).filter(Boolean).length;
}

/** Calculate reading time in minutes (200 words/min). */
export function calculateReadingTime(content: string): number {
  return Math.ceil(calculateWordCount(content) / 200);
}

/** Generate a URL-safe slug from a title. */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 200);
}

/** Strip HTML tags for plain text extraction. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface TipTapNode {
  content?: TipTapNode[];
  text?: string;
  type?: string;
}

const DEFAULT_BLOG_PREVIEW = 'Read this blog post';
const MAX_TIPTAP_DEPTH = 75;

function tryParseJson(content: unknown): unknown | null {
  if (typeof content !== 'string') {
    return content ?? null;
  }

  try {
    return JSON.parse(content.trim());
  } catch {
    return null;
  }
}

function extractTipTapText(
  node: TipTapNode,
  depth = 0,
  maxDepth = MAX_TIPTAP_DEPTH
): string {
  if (depth >= maxDepth) {
    return node.text?.trim() || '';
  }

  const childText =
    node.content
      ?.map((childNode) => extractTipTapText(childNode, depth + 1, maxDepth))
      .join(' ') || '';
  return [node.text, childText].filter(Boolean).join(' ').trim();
}

function isTipTapDoc(value: unknown): value is TipTapNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    (value as Record<string, unknown>).type === 'doc'
  );
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  return lastSpace > 0
    ? `${truncated.slice(0, lastSpace)}...`
    : `${truncated.trimEnd()}...`;
}

/** Extract plain preview text from HTML, plain text, or TipTap JSON content. */
export function getBlogPostTextPreview(
  content: unknown,
  maxLength = 160,
  fallback = DEFAULT_BLOG_PREVIEW
): string {
  const parsedJson = tryParseJson(content);

  if (parsedJson && typeof parsedJson === 'object') {
    if (isTipTapDoc(parsedJson)) {
      const text = extractTipTapText(parsedJson).replace(/\s+/g, ' ').trim();

      return text ? truncateText(text, maxLength) : fallback;
    }

    return fallback;
  }

  if (typeof content === 'string') {
    const text = stripHtml(content).replace(/\s+/g, ' ').trim();
    return text ? truncateText(text, maxLength) : fallback;
  }

  return fallback;
}

/** Auto-generate a meta description from HTML content. */
export function generateSeoDescription(
  content: string,
  maxLength = 155
): string {
  const plainText = stripHtml(content);
  return truncateText(plainText, maxLength);
}

/** Auto-generate an excerpt from HTML content. */
export function generateExcerpt(content: string, maxLength = 300): string {
  const plainText = stripHtml(content);
  return truncateText(plainText, maxLength);
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'can',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'you',
  'your',
  'we',
  'our',
  'they',
  'their',
  'i',
  'my',
  'me',
  'he',
  'she',
  'him',
  'her',
  'as',
  'if',
  'then',
  'than',
  'so',
  'just',
  'only',
  'also',
  'very',
  'too',
]);

/** Extract top keywords from title and content. */
export function extractKeywords(title: string, content: string): string[] {
  const plainText = stripHtml(content).toLowerCase();
  const titleWords = title.toLowerCase().split(/\s+/);

  const keywords = titleWords.filter(
    (word) => word.length > 3 && !STOP_WORDS.has(word)
  );

  const contentWords = plainText
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 4 && !STOP_WORDS.has(word) && !keywords.includes(word)
    );

  const wordCount: Record<string, number> = {};
  for (const word of contentWords) {
    wordCount[word] = (wordCount[word] || 0) + 1;
  }

  const topContentWords = Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10 - keywords.length)
    .map(([word]) => word);

  return [...new Set([...keywords, ...topContentWords])].slice(0, 10);
}

/**
 * Generate a heading ID from text content for anchor links.
 * Converts "My Heading Title" → "my-heading-title"
 */
export function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
