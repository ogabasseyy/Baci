import {
  type CategoryGuideCopy,
  type CategoryGuideCopyItem,
  getOgabasseyCategoryGuideCopy,
} from './blog-category-guide-copy';

function toGuideItems(
  prefix: string,
  items: string[]
): CategoryGuideCopyItem[] {
  return items.map((text, index) => ({
    id: `${prefix}-${index + 1}`,
    text,
  }));
}

function buildCategoryGuideCopy({
  category,
  isOgabasseyBlogTenant,
  merchantName,
  totalPosts,
}: {
  category: string;
  isOgabasseyBlogTenant: boolean;
  merchantName: string;
  totalPosts: number;
}): CategoryGuideCopy {
  if (isOgabasseyBlogTenant) {
    const guide = getOgabasseyCategoryGuideCopy(category);
    if (guide) {
      return guide;
    }
  }

  const genericGuideKey =
    category
      .trim()
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'category';

  return {
    heading: `About ${category} articles from ${merchantName}`,
    paragraphs: toGuideItems(`${genericGuideKey}-paragraph`, [
      `${merchantName} uses this category to organize ${category.toLowerCase()} articles in one place so readers can scan recent updates, compare related topics and move from research to the most relevant store pages without relying on a single short listing view.`,
      `There ${totalPosts === 1 ? 'is' : 'are'} ${totalPosts} ${totalPosts === 1 ? 'article' : 'articles'} in this archive. Use the newest posts first, then review related categories, author pages and product links when you need more context before taking the next step.`,
    ]),
    bullets: toGuideItems(`${genericGuideKey}-bullet`, [
      'Start with recent posts for the freshest context.',
      'Use related categories to continue the research path.',
      'Check linked products or policies before making a decision.',
    ]),
  };
}

export function BlogCategoryGuide({
  category,
  isOgabasseyBlogTenant = false,
  merchantName,
  totalPosts,
}: {
  category: string;
  isOgabasseyBlogTenant?: boolean;
  merchantName: string;
  totalPosts: number;
}) {
  const guide = buildCategoryGuideCopy({
    category,
    isOgabasseyBlogTenant,
    merchantName,
    totalPosts,
  });

  return (
    <section
      aria-labelledby="blog-category-guide-heading"
      className="mb-8 rounded-2xl border bg-card p-6 text-card-foreground shadow-sm"
    >
      <h2 id="blog-category-guide-heading" className="text-xl font-semibold">
        {guide.heading}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
        {guide.paragraphs.map((paragraph) => (
          <p key={paragraph.id}>{paragraph.text}</p>
        ))}
      </div>
      <ul className="mt-4 grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
        {guide.bullets.map((bullet) => (
          <li key={bullet.id} className="rounded-xl bg-muted/50 px-3 py-2">
            {bullet.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
