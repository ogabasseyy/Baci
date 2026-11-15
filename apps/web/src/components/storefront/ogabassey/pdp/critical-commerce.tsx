import type { Route } from 'next';
import { Suspense } from 'react';
import {
  OgabasseyPdpCriticalCommerceConditionFact,
  OgabasseyPdpCriticalCommerceControls,
} from './critical-commerce.client';
import type { OgabasseyPdpCriticalProduct } from './critical-product';
import { ProductOwnershipLinks } from './product-ownership-links';

interface OgabasseyPdpCriticalCommerceProps {
  cartBasePathPromise?: Promise<string>;
  cartHref?: Route;
  product: Pick<
    OgabasseyPdpCriticalProduct,
    | 'brand'
    | 'categoryName'
    | 'categorySlug'
    | 'condition'
    | 'id'
    | 'image'
    | 'name'
    | 'price'
    | 'slug'
    | 'stockQuantity'
  > & {
    variantCount?: number;
  };
}

async function OgabasseyPdpResolvedCriticalCommerceControls({
  basePathPromise,
  productName,
}: {
  basePathPromise: Promise<string>;
  productName: string;
}) {
  const basePath = await basePathPromise;
  const cartHref = `${basePath}/cart` as Route;

  return (
    <>
      <ProductOwnershipLinks cartHref={cartHref} />
      <OgabasseyPdpCriticalCommerceControls
        cartHref={cartHref}
        productName={productName}
      />
    </>
  );
}

export function OgabasseyPdpCriticalCommerce({
  cartBasePathPromise,
  cartHref,
  product,
}: OgabasseyPdpCriticalCommerceProps) {
  const controls = cartHref ? (
    <>
      <ProductOwnershipLinks cartHref={cartHref} />
      <OgabasseyPdpCriticalCommerceControls
        cartHref={cartHref}
        productName={product.name}
      />
    </>
  ) : cartBasePathPromise ? (
    <Suspense fallback={null}>
      <OgabasseyPdpResolvedCriticalCommerceControls
        basePathPromise={cartBasePathPromise}
        productName={product.name}
      />
    </Suspense>
  ) : null;

  return (
    <aside data-ogabassey-pdp-commerce-panel aria-label="Purchase options">
      <div data-ogabassey-pdp-commerce-facts>
        <p data-ogabassey-pdp-commerce-eyebrow>Ready to buy</p>
        <OgabasseyPdpCriticalCommerceConditionFact
          fallbackCondition={product.condition}
        />
        <p data-ogabassey-pdp-commerce-fact>
          <span>Delivery</span>
          <strong>Lagos and nationwide</strong>
        </p>
      </div>
      {controls}
    </aside>
  );
}
