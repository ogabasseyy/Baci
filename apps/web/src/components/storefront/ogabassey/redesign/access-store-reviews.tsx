'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import type { GooglePlacesReviewsResponse } from '@/lib/google-places-reviews';

/** Mounted by the existing deferred footer, outside the critical product path. */
export function AccessStoreReviews({ placeId }: { placeId: string }) {
  const [result, setResult] = useState<GooglePlacesReviewsResponse | null>(
    null
  );
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void fetch(
      `/api/google-places/reviews?${new URLSearchParams({ placeId })}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        if (!response.ok) return;
        const data: GooglePlacesReviewsResponse = await response.json();
        if (!controller.signal.aborted && Array.isArray(data.reviews))
          setResult(data);
      })
      .catch(() => {
        /* Keep the Google Maps link available when the provider is unavailable. */
      });
    return () => controller.abort();
  }, [placeId]);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=Ogabassey&query_place_id=${encodeURIComponent(placeId)}`;
  return (
    <section
      className="oa-store-reviews"
      aria-label="Store reviews from Google"
    >
      <p className="oa-footer-kicker">The people have their say</p>
      <h2>Reviews don’t lie.</h2>
      <p>Real experiences with our store. Straight from Google Maps.</p>
      {result ? (
        <p>
          <strong>{result.rating} / 5</strong> · {result.totalReviews} reviews ·
          Most relevant
        </p>
      ) : null}
      <a
        href={result?.googleMapsUrl || mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Read reviews on Google Maps ↗
      </a>
      {result ? (
        <div className="oa-store-review-list">
          {result.reviews.map((review) => (
            <article key={`${review.authorName}-${review.timestamp}`}>
              <a
                href={review.authorUrl || mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {review.authorPhoto ? (
                  <Image
                    src={review.authorPhoto}
                    alt={`${review.authorName} profile photo`}
                    width={32}
                    height={32}
                    unoptimized
                    loading="lazy"
                    style={{ borderRadius: '50%', display: 'inline-block', marginRight: 8, verticalAlign: 'middle' }}
                  />
                ) : null}
                {review.authorName}
              </a>
              <p role="img" aria-label={`${review.rating} out of 5 stars`}>
                {'★'.repeat(
                  Math.max(0, Math.min(5, Math.round(review.rating)))
                )}
              </p>
              <small>{review.relativeTime}</small>
              {review.text ? <blockquote>{review.text}</blockquote> : null}
              <a
                href={review.googleMapsUri || mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Google Maps ↗
              </a>
            </article>
          ))}
        </div>
      ) : null}
      {result?.attributions.map((attribution) => (
        <p key={`${attribution.provider}-${attribution.providerUri}`}>
          {attribution.providerUri ? (
            <a href={attribution.providerUri}>{attribution.provider}</a>
          ) : (
            attribution.provider
          )}
        </p>
      ))}
    </section>
  );
}
