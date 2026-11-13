import Link from 'next/link';
import { Suspense } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { IS_BLACK_FRIDAY_PREVIEW } from '@/config/ogabassey-black-friday';
import { getBlackFridayProducts } from '@/lib/ogabassey-black-friday';
import { asRoute } from '@/lib/routes';
import { BlackFridayFilters } from './black-friday-filters';
import { getBlackFridayLineupView } from './black-friday-lineup-view';
import styles from './ogabassey-black-friday-page.module.css';

interface BlackFridayPageProps {
  pathPrefix: string;
  filters?: Promise<Record<string, string | string[] | undefined>>;
}

export function OgabasseyBlackFridayPage(props: BlackFridayPageProps) {
  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          {IS_BLACK_FRIDAY_PREVIEW ? (
            <p className={styles.preview}>Sample lineup</p>
          ) : null}
          <h1 className={styles.title}>
            Black <span className={styles.accent}>Friday</span>
          </h1>
          <p className={styles.description}>
            Find your next upgrade in our Black Friday lineup.
          </p>
          <a className={styles.heroLink} href="#black-friday-offers">
            Shop the lineup <span aria-hidden="true">↓</span>
          </a>
        </div>
        {/* biome-ignore lint/performance/noImgElement: Local WebP sizes are encoded ahead of time. */}
        <img
          alt=""
          className={styles.heroArt}
          width={768}
          height={768}
          src="/campaigns/black-friday-hero-768.webp"
          srcSet="/campaigns/black-friday-hero-384.webp 384w, /campaigns/black-friday-hero-768.webp 768w"
          sizes="(min-width: 80rem) 616px, (min-width: 28rem) 50vw, calc(100vw - 2rem)"
          fetchPriority="high"
        />
      </header>
      <section aria-label="Black Friday offers" className={styles.offers}>
        <div
          id="black-friday-offers"
          className={styles.offersAnchor}
          aria-hidden="true"
        />
        <Suspense fallback={<BlackFridayOffersLoading />}>
          <BlackFridayOffers {...props} />
        </Suspense>
      </section>
    </section>
  );
}

function BlackFridayOffersLoading() {
  return (
    <>
      <div
        className={styles.filtersPlaceholder}
        role="status"
        aria-label="Loading Black Friday offers"
      />
      <div className={styles.products} aria-hidden="true">
        {[1, 2, 3, 4].map((card) => (
          <div className={styles.productPlaceholder} key={card} />
        ))}
      </div>
    </>
  );
}

export async function BlackFridayOffers({
  pathPrefix,
  filters,
}: BlackFridayPageProps) {
  const products = await getBlackFridayProducts();
  const { products: matchingProducts, ...selection } = getBlackFridayLineupView(
    products,
    (await filters) ?? {}
  );

  return products.length ? (
    <>
      <BlackFridayFilters
        key={JSON.stringify(selection)}
        pathPrefix={pathPrefix}
        selection={selection}
        count={matchingProducts.length}
      />
      {matchingProducts.length ? (
        <ul aria-label="Matching products" className={styles.products}>
          {matchingProducts.map((product) => (
            <li key={product.id}>
              <Link
                className={styles.card}
                href={asRoute(`${pathPrefix}${product.href}`)}
                prefetch={false}
              >
                {product.image ? (
                  // A streamed fill image needs a containing block before CSS arrives.
                  <div
                    className={styles.image}
                    style={{ position: 'relative', aspectRatio: '1' }}
                  >
                    <CdnFormatImage
                      alt=""
                      className={styles.imageContent}
                      fill
                      style={{ objectFit: 'contain' }}
                      sizes="(min-width: 1280px) 240px, (min-width: 1024px) calc((100vw - 22rem) / 3), (min-width: 640px) 33vw, 50vw"
                      src={product.image}
                    />
                  </div>
                ) : null}
                <div className={styles.cardContent}>
                  <h2 className={styles.name}>{product.name}</h2>
                  <p className={styles.prices}>
                    <span className={styles.price}>{product.price}</span>
                    {product.compareAtPrice ? (
                      <s className={styles.comparePrice}>
                        <span className="sr-only">Original price </span>
                        {product.compareAtPrice}
                      </s>
                    ) : null}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No offers match these filters.</p>
      )}
    </>
  ) : (
    <div className={styles.emptyOffers}>
      <p>Our Black Friday lineup will appear here when it’s ready.</p>
      <Link
        className="mt-3 inline-block font-semibold underline"
        href={asRoute(`${pathPrefix}/products`)}
      >
        Browse all products
      </Link>
    </div>
  );
}
