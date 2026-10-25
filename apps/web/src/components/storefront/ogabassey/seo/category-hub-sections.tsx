import { CheckCircle } from 'lucide-react';
import { SafeHtml } from '@/components/ui/safe-html';
import type { CategoryHubModel } from '@/lib/storefront-category/category-hub-types';
import { CategoryHubCardGrid } from './category-hub-card-grid';
import { CategoryHubFaqAccordion } from './category-hub-faq-accordion';

interface CategoryHubSectionsProps {
  comparisonHeading?: string;
  hub: CategoryHubModel;
  headingIdPrefix?: string;
}

function buildHeadingId(title: string, prefix?: string) {
  const baseId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return prefix ? `${prefix}-${baseId}` : baseId;
}

export function CategoryHubSections({
  comparisonHeading = 'Compare and Buying Guides',
  hub,
  headingIdPrefix,
}: CategoryHubSectionsProps) {
  const introHeading =
    hub.intro.heading.trim().length > 0 ? hub.intro.heading : 'Introduction';
  const hasIntro =
    hub.intro.heading.trim().length > 0 ||
    hub.intro.description.trim().length > 0;
  const hasTrustFeatures = hub.trustFeatures.length > 0;
  const hasComparisonLinks = hub.comparisonLinks.length > 0;
  const hasGuideLinks = hub.guideLinks.length > 0;
  const hasFaqItems = hub.faqItems.length > 0;
  const hasAnyCards =
    hub.bestForCards.length > 0 ||
    hub.brandCards.length > 0 ||
    hub.priceBandCards.length > 0;

  if (
    !hasIntro &&
    !hasTrustFeatures &&
    !hasAnyCards &&
    !hasComparisonLinks &&
    !hasGuideLinks &&
    !hasFaqItems
  ) {
    return null;
  }

  return (
    <section
      aria-label="Category hub sections"
      className="max-w-[1400px] mx-auto px-4 md:px-6 mt-16 border-t border-store-background-text/10 pt-16 content-auto [contain-intrinsic-size:1400px_900px]"
    >
      <div className="space-y-8">
        {hasIntro ? (
          <section
            aria-labelledby={buildHeadingId(introHeading, headingIdPrefix)}
            className="space-y-4 rounded-3xl border border-store-background-text/10 bg-store-background p-5 md:p-6"
          >
            <h2
              id={buildHeadingId(introHeading, headingIdPrefix)}
              className="text-2xl font-bold text-store-background-text"
            >
              {introHeading}
            </h2>
            {hub.intro.description ? (
              <p className="max-w-3xl text-sm leading-7 text-store-background-text/70">
                {hub.intro.description}
              </p>
            ) : null}
          </section>
        ) : null}

        {hasTrustFeatures ? (
          <section
            aria-labelledby={buildHeadingId('Why shop here', headingIdPrefix)}
            className="space-y-4 rounded-3xl border border-store-background-text/10 bg-store-background p-5 md:p-6"
          >
            <h2
              id={buildHeadingId('Why shop here', headingIdPrefix)}
              className="text-lg font-semibold text-store-background-text"
            >
              Why shop here
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {hub.trustFeatures.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2 text-sm text-store-background-text/75"
                >
                  <CheckCircle
                    size={16}
                    className="mt-0.5 shrink-0 text-store-primary"
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <CategoryHubCardGrid title="Best for" cards={hub.bestForCards} />
        <CategoryHubCardGrid title="Brands and product picks" cards={hub.brandCards} />
        <CategoryHubCardGrid
          title="Best price bands"
          cards={hub.priceBandCards}
        />

        {hasComparisonLinks ? (
          <section
            aria-labelledby={buildHeadingId(
              comparisonHeading,
              headingIdPrefix
            )}
            className="space-y-4 rounded-3xl border border-store-background-text/10 bg-store-background p-5 md:p-6"
          >
            <h2
              id={buildHeadingId(comparisonHeading, headingIdPrefix)}
              className="text-lg font-semibold text-store-background-text"
            >
              {comparisonHeading}
            </h2>
            <ul className="space-y-3">
              {hub.comparisonLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm font-medium text-store-primary underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {hasGuideLinks ? (
          <section
            aria-labelledby={buildHeadingId(
              'Buyer guides and support articles',
              headingIdPrefix
            )}
            className="space-y-4 rounded-3xl border border-store-background-text/10 bg-store-background p-5 md:p-6"
          >
            <h2
              id={buildHeadingId(
                'Buyer guides and support articles',
                headingIdPrefix
              )}
              className="text-lg font-semibold text-store-background-text"
            >
              Buyer guides and support articles
            </h2>
            <ul className="space-y-4">
              {hub.guideLinks.map((link) => (
                <li key={link.href} className="space-y-1">
                  <a
                    href={link.href}
                    className="text-sm font-semibold text-store-primary underline-offset-4 hover:underline"
                  >
                    {link.title}
                  </a>
                  <p className="text-sm leading-6 text-store-background-text/70">
                    {link.description}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {hasFaqItems ? (
          <section
            aria-labelledby={buildHeadingId(
              'Frequently Asked Questions',
              headingIdPrefix
            )}
            className="space-y-4 rounded-3xl border border-store-background-text/10 bg-store-background p-5 md:p-6"
          >
            <h2
              id={buildHeadingId(
                'Frequently Asked Questions',
                headingIdPrefix
              )}
              className="text-lg font-semibold text-store-background-text"
            >
              Frequently Asked Questions
            </h2>
            <CategoryHubFaqAccordion
              items={hub.faqItems.map((faq, index) => ({
                // Content-derived key (not index) so reordering duplicate-question
                // items does not reuse a Radix item's open/closed state.
                reactKey: `${faq.question}-${faq.answer}`,
                value: `faq-${index}`,
                question: faq.question,
                // Sanitized on the server; only the sanitized element crosses
                // into the client accordion, never `sanitize-html` itself.
                answer: <SafeHtml html={faq.answer} />,
              }))}
            />
          </section>
        ) : null}
      </div>
    </section>
  );
}
