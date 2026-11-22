import Link from 'next/link';
import { SearchSubmissionLink } from '@/components/storefront/search-submission-link';
import type { findGiftCardPreviewMatches } from '@/lib/gift-cards/preview-catalog';
import { asRoute } from '@/lib/routes';

export function SearchPageSuggestions({
  giftCards,
  didYouMean,
  pathPrefix,
}: {
  giftCards: ReturnType<typeof findGiftCardPreviewMatches>;
  didYouMean?: string | null;
  pathPrefix: string;
}) {
  return (
    <>
      {giftCards.length > 0 && (
        <section className="mt-4 space-y-2" aria-labelledby="gift-card-results">
          <h2 id="gift-card-results" className="font-semibold">
            Gift Cards
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {giftCards.map((card) => (
              <li key={card.id}>
                <Link
                  href={asRoute(
                    `${pathPrefix}/gift-cards?selection=${card.id}`
                  )}
                  className="block rounded-lg border bg-store-background p-3 text-store-background-text hover:underline"
                >
                  {card.brand} · United States · {`$${card.denomination}`}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {didYouMean && (
        <p className="mt-4 text-sm text-store-background-text/55">
          Did you mean{' '}
          <SearchSubmissionLink
            pathPrefix={pathPrefix}
            query={didYouMean}
            source="did-you-mean"
            className="font-medium text-store-primary underline-offset-4 hover:underline"
          >
            {didYouMean}
          </SearchSubmissionLink>
          ?
        </p>
      )}
    </>
  );
}
