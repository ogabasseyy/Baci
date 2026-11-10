import type { CategoryHubCard } from '@/lib/storefront-category/category-hub-types';

interface CategoryHubCardGridProps {
  title: string;
  cards: CategoryHubCard[];
}

function buildHeadingId(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function getDisambiguatedAriaLabel(label: string): string | undefined {
  const expanded = label.replace(/(\w)\s*\+(?=[\s,.;:!?)]|$)/g, '$1 Plus');
  return expanded !== label ? `${label} (${expanded})` : undefined;
}

export function CategoryHubCardGrid({
  title,
  cards,
}: CategoryHubCardGridProps) {
  if (cards.length === 0) {
    return null;
  }

  const headingId = buildHeadingId(title);

  return (
    <section aria-labelledby={headingId} className="ogabassey-category-hub-card">
      <h3 id={headingId} className="ogabassey-category-hub-card__title">
        {title}
      </h3>
      <div className="ogabassey-category-hub-card-grid">
        {cards.map((card) => (
          <article
            key={card.href}
            className="ogabassey-category-hub-card-grid__item"
          >
            {card.eyebrow ? (
              <p className="ogabassey-category-hub-card-grid__eyebrow">
                {card.eyebrow}
              </p>
            ) : null}
            <h4 className="ogabassey-category-hub-card-grid__title">
              <a
                href={card.href}
                aria-label={getDisambiguatedAriaLabel(card.title)}
                className="ogabassey-category-hub-card__link"
              >
                {card.title}
              </a>
            </h4>
            <p className="ogabassey-category-hub-card__description">
              {card.description}
            </p>
            {card.secondaryHref && card.secondaryLabel ? (
              <div className="ogabassey-category-hub-card-grid__secondary">
                <a
                  href={card.secondaryHref}
                  aria-label={getDisambiguatedAriaLabel(card.secondaryLabel)}
                  className="ogabassey-category-hub-card__link"
                >
                  {card.secondaryLabel}
                </a>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
