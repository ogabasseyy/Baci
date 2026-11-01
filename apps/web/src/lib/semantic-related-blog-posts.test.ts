import { expect, it } from 'vitest';
import {
  type SemanticBlogPostInput,
  scoreSemanticRelatedBlogPost,
  selectSemanticRelatedBlogPosts,
} from './semantic-related-blog-posts';

const source: SemanticBlogPostInput = {
  id: 'source',
  title: 'MacBook Air M3 in Nigeria: buyer support guide',
  category: 'Laptops',
  tags: ['Apple', 'MacBook', 'Laptops'],
  keywords: ['macbook air m3', 'apple laptop nigeria'],
  excerpt: 'Choose between 13-inch and 15-inch MacBook Air M3 models.',
  published_at: '2026-06-08T12:00:00Z',
};

it('scores category, entity, keyword, and title overlap above category-only matches', () => {
  const semanticMatch: SemanticBlogPostInput = {
    id: 'semantic',
    title: 'MacBook Ultra rumors and Apple laptop buying advice',
    category: 'Laptops',
    tags: ['Apple', 'MacBook'],
    keywords: ['apple laptop nigeria'],
    excerpt: 'A MacBook buyer guide for Apple laptop shoppers.',
  };
  const categoryOnly: SemanticBlogPostInput = {
    id: 'category',
    title: 'Budget Windows laptops for students',
    category: 'Laptops',
    tags: ['Windows'],
    keywords: ['student laptop'],
    excerpt: 'A general laptop guide.',
  };

  expect(scoreSemanticRelatedBlogPost(source, semanticMatch)).toBeGreaterThan(
    scoreSemanticRelatedBlogPost(source, categoryOnly)
  );
});

it('selects the strongest semantic matches and ignores unrelated posts', () => {
  const selected = selectSemanticRelatedBlogPosts(
    source,
    [
      {
        id: 'unrelated',
        title: 'OPPO screen repair symptoms',
        category: 'Repairs',
        tags: ['OPPO'],
        keywords: ['screen repair'],
        published_at: '2026-06-09T12:00:00Z',
      },
      {
        id: 'macbook-ultra',
        title: 'MacBook Ultra rumors and Apple laptop buying advice',
        category: 'Laptops',
        tags: ['Apple', 'MacBook'],
        keywords: ['apple laptop nigeria'],
        published_at: '2026-06-07T12:00:00Z',
      },
      {
        id: 'hp-envy',
        title: 'HP Envy x360 14 vs 16 comparison',
        category: 'Laptops',
        tags: ['HP', 'Laptops'],
        keywords: ['laptop comparison'],
        published_at: '2026-06-08T12:00:00Z',
      },
    ],
    2
  );

  expect(selected.map((post) => post.id)).toEqual(['macbook-ultra', 'hp-envy']);
});

it('uses recency as a deterministic tie-breaker after semantic score', () => {
  const selected = selectSemanticRelatedBlogPosts(
    source,
    [
      {
        id: 'older',
        title: 'Apple laptop guide',
        category: 'Laptops',
        tags: ['Apple'],
        keywords: ['apple laptop nigeria'],
        published_at: '2026-06-01T12:00:00Z',
      },
      {
        id: 'newer',
        title: 'Apple laptop guide',
        category: 'Laptops',
        tags: ['Apple'],
        keywords: ['apple laptop nigeria'],
        published_at: '2026-06-02T12:00:00Z',
      },
    ],
    1
  );

  expect(selected[0]?.id).toBe('newer');
});

it('pads partial semantic results with recent unmatched posts', () => {
  const selected = selectSemanticRelatedBlogPosts(
    source,
    [
      {
        id: 'recent-unmatched',
        title: 'OPPO screen repair symptoms',
        category: 'Repairs',
        tags: ['OPPO'],
        keywords: ['screen repair'],
        published_at: '2026-06-09T12:00:00Z',
      },
      {
        id: 'semantic',
        title: 'MacBook Air M3 buying advice',
        category: 'Laptops',
        tags: ['Apple', 'MacBook'],
        keywords: ['apple laptop nigeria'],
        published_at: '2026-06-07T12:00:00Z',
      },
      {
        id: 'older-unmatched',
        title: 'Samsung watch strap guide',
        category: 'Wearables',
        tags: ['Samsung'],
        keywords: ['watch straps'],
        published_at: '2026-06-01T12:00:00Z',
      },
    ],
    3
  );

  expect(selected.map((post) => post.id)).toEqual([
    'semantic',
    'recent-unmatched',
    'older-unmatched',
  ]);
});

it('does not create semantic matches from sliced partial words', () => {
  const longSource: SemanticBlogPostInput = {
    id: 'source-long',
    title: `${'filler '.repeat(31)}technology`,
  };
  const partialCandidate: SemanticBlogPostInput = {
    id: 'partial',
    title: 'tec',
  };

  expect(scoreSemanticRelatedBlogPost(longSource, partialCandidate)).toBe(0);
});

it('scores focus_keyword and tokenized multi-word keyword overlap when keywords[] is null', () => {
  const tecnoSource: SemanticBlogPostInput = {
    id: 'tecno-camon-slim',
    title: 'Tecno Camon Slim Price in Nigeria',
    category: 'Smartphones',
    focus_keyword: 'tecno camon slim price in nigeria',
    keywords: null,
  };
  const sameBrandCandidate: SemanticBlogPostInput = {
    id: 'tecno-camon-50-pro',
    title: 'Charging habits for your phone',
    category: 'Smartphones',
    focus_keyword: 'tecno camon 50 pro price in nigeria',
    keywords: null,
  };
  const unrelatedBrandCandidate: SemanticBlogPostInput = {
    id: 'iphone-17-pro',
    title: 'Charging habits for your phone',
    category: 'Smartphones',
    focus_keyword: 'iphone 17 pro price in nigeria',
    keywords: null,
  };

  expect(
    scoreSemanticRelatedBlogPost(tecnoSource, sameBrandCandidate)
  ).toBeGreaterThan(
    scoreSemanticRelatedBlogPost(tecnoSource, unrelatedBrandCandidate)
  );
});
