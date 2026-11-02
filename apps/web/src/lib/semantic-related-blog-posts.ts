import { scoreBlogPostBrandAffinity } from './blog-post-brand-affinity';

const MAX_TOKEN_COUNT = 24;
const MAX_TEXT_LENGTH = 220;
const BOILERPLATE_BLOG_METADATA_PHRASES = new Set([
  'accessories',
  'audio',
  'buyer guide',
  'buying guide',
  'gaming',
  'laptop',
  'laptops',
  'monitors',
  'nigeria',
  'nigeria buyer guide',
  'phone',
  'phones',
  'price in nigeria',
  'printers',
  'smart tvs',
  'smartphone',
  'smartphones',
  'tablet',
  'tablets',
  'wearables',
]);
const STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'and',
  'are',
  'before',
  'best',
  'buyer',
  'buyers',
  'buying',
  'can',
  'check',
  'for',
  'from',
  'guide',
  'has',
  'how',
  'into',
  'its',
  'make',
  'more',
  'need',
  'new',
  'nigeria',
  'nigerian',
  'now',
  'options',
  'should',
  'the',
  'this',
  'what',
  'when',
  'which',
  'why',
  'with',
  'worth',
  'you',
]);

export interface SemanticBlogPostInput {
  category?: string | null;
  excerpt?: string | null;
  focus_keyword?: string | null;
  id: string;
  keywords?: string[] | null;
  featured_image_url?: string | null;
  published_at?: string | null;
  slug?: string | null;
  tags?: string[] | null;
  title?: string | null;
}

interface ScoredRelatedPost<T extends SemanticBlogPostInput> {
  index: number;
  post: T;
  score: number;
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value: unknown, limit = MAX_TOKEN_COUNT): string[] {
  const normalized = normalizeText(value);

  if (!normalized) {
    return [];
  }

  const tokens: string[] = [];
  let consumedLength = 0;

  for (const token of normalized.split(/\s+/)) {
    const nextLength =
      consumedLength + token.length + (tokens.length > 0 ? 1 : 0);
    if (nextLength > MAX_TEXT_LENGTH) {
      break;
    }

    consumedLength = nextLength;
    if (token.length > 2 && !STOP_WORDS.has(token)) {
      tokens.push(token);
    }
  }

  return [...new Set(tokens)].slice(0, limit);
}

function normalizeStringArray(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => normalizeText(item))
        .filter(
          (item) =>
            item.length > 0 && !BOILERPLATE_BLOG_METADATA_PHRASES.has(item)
        )
    ),
  ];
}

function intersectionCount(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

function dateTime(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractKeywords(input: SemanticBlogPostInput): string[] {
  const combined = [
    ...(typeof input.focus_keyword === 'string' ? [input.focus_keyword] : []),
    ...(Array.isArray(input.keywords) ? input.keywords : []),
  ];
  return normalizeStringArray(combined);
}

function extractBrandTexts(input: SemanticBlogPostInput): string[] {
  return [
    ...(typeof input.title === 'string' ? [input.title] : []),
    ...(typeof input.focus_keyword === 'string' ? [input.focus_keyword] : []),
    ...(Array.isArray(input.tags) ? input.tags : []),
    ...(Array.isArray(input.keywords) ? input.keywords : []),
  ];
}

export function scoreSemanticRelatedBlogPost(
  source: SemanticBlogPostInput,
  candidate: SemanticBlogPostInput
): number {
  let score = 0;

  const sourceCategory = normalizeText(source.category);
  const candidateCategory = normalizeText(candidate.category);
  if (sourceCategory && sourceCategory === candidateCategory) {
    score += 18;
  }

  const sourceTags = normalizeStringArray(source.tags);
  const candidateTags = normalizeStringArray(candidate.tags);
  score += Math.min(intersectionCount(sourceTags, candidateTags), 4) * 8;

  const sourceKeywords = extractKeywords(source);
  const candidateKeywords = extractKeywords(candidate);
  score +=
    Math.min(intersectionCount(sourceKeywords, candidateKeywords), 4) * 7;

  const sourceTitleTokens = tokenize(source.title);
  const candidateTitleTokens = tokenize(candidate.title);
  score +=
    Math.min(intersectionCount(sourceTitleTokens, candidateTitleTokens), 5) * 5;

  const sourceExcerptTokens = tokenize(source.excerpt);
  const candidateExcerptTokens = tokenize(candidate.excerpt);
  score +=
    Math.min(
      intersectionCount(sourceExcerptTokens, candidateExcerptTokens),
      5
    ) * 2;

  const sourceTopicTokens = [
    ...new Set([
      ...sourceTitleTokens,
      ...sourceTags,
      ...sourceKeywords,
      ...tokenize(sourceTags.join(' ')),
      ...tokenize(sourceKeywords.join(' ')),
    ]),
  ];
  const candidateTopicTokens = [
    ...new Set([
      ...candidateTitleTokens,
      ...candidateTags,
      ...candidateKeywords,
      ...tokenize(candidateTags.join(' ')),
      ...tokenize(candidateKeywords.join(' ')),
    ]),
  ];
  score +=
    Math.min(intersectionCount(sourceTopicTokens, candidateTopicTokens), 6) * 3;
  score += scoreBlogPostBrandAffinity(
    extractBrandTexts(source),
    extractBrandTexts(candidate)
  );

  if (candidate.featured_image_url && score > 0) {
    score += 1;
  }

  return Math.max(0, score);
}

export function selectSemanticRelatedBlogPosts<T extends SemanticBlogPostInput>(
  source: SemanticBlogPostInput,
  candidates: T[],
  limit: number
): T[] {
  if (limit <= 0) {
    return [];
  }

  const eligibleCandidates = candidates.filter((post) => post.id !== source.id);
  const scoredCandidates = eligibleCandidates
    .map(
      (post, index): ScoredRelatedPost<T> => ({
        index,
        post,
        score: scoreSemanticRelatedBlogPost(source, post),
      })
    )
    .filter(({ score }) => score > 0);

  const selectedPosts = scoredCandidates
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const rightPublishedAt = dateTime(right.post.published_at);
      const leftPublishedAt = dateTime(left.post.published_at);
      if (rightPublishedAt !== leftPublishedAt) {
        return rightPublishedAt - leftPublishedAt;
      }

      return left.index - right.index;
    })
    .slice(0, limit)
    .map(({ post }) => post);

  if (selectedPosts.length >= limit) {
    return selectedPosts;
  }

  const selectedPostIds = new Set(selectedPosts.map((post) => post.id));
  const paddingPosts = eligibleCandidates
    .filter((post) => !selectedPostIds.has(post.id))
    .slice(0, limit - selectedPosts.length);

  return [...selectedPosts, ...paddingPosts];
}
