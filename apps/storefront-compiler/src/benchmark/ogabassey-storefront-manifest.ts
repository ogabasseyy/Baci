import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';

export function createOgabasseyStorefrontManifest(): WorkerStorefrontManifest {
  return {
    format: 'baci.storefront-worker/v1',
    mode: 'full-code',
    entry: 'src/StorefrontApp.tsx',
    packages: [
      { name: 'react', versionRef: 'platform-pinned' },
      { name: 'react-dom', versionRef: 'platform-pinned' },
      { name: '@baci/experience-sdk', versionRef: 'platform-pinned' },
    ],
    routes: [
      { path: '/', view: 'home' },
      { path: '/search', view: 'search' },
      { path: '/cart', view: 'cart' },
      { path: '/:category', view: 'collection' },
      { path: '/:category/:productSlug', view: 'product' },
    ],
    assets: [
      { assetId: 'hero-banner', alt: 'Ogabassey flagship devices banner' },
    ],
    themeTokens: {
      primary: 'hsl(222 47% 11%)',
      secondary: 'hsl(210 40% 96%)',
      accent: 'hsl(358 78% 52%)',
    },
    cspAllowlist: {
      scriptOrigins: ['https://www.googletagmanager.com'],
      connectOrigins: ['https://www.google-analytics.com'],
      imgOrigins: ['https://cdn.usebaci.com'],
    },
    files: [
      {
        path: 'src/styles/theme.css',
        content: `
.storefront-shell {
  background-color: var(--theme-secondary);
  color: var(--theme-primary);
}
.accent-cta {
  background-color: var(--theme-accent);
  color: var(--theme-secondary);
}
`,
      },
      {
        path: 'src/components/ProductCard.tsx',
        content: `
export interface CardProduct {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  brand: string;
  condition: string;
  priceNgn: number;
  inStock: boolean;
  imageUrl: string;
  imageAlt: string;
  shortSpecs: string;
}

export function ProductCard({ product }: { product: CardProduct }) {
  return (
    <article className="rounded-2xl border p-4 shadow-sm flex flex-col justify-between gap-3">
      <div>
        <img
          src={product.imageUrl}
          alt={product.imageAlt}
          loading="lazy"
          width={320}
          height={320}
          className="w-full h-48 object-contain rounded-xl"
        />
        <p className="text-xs uppercase tracking-wider mt-2 opacity-75">
          {product.brand} · {product.condition}
        </p>
        <h2 className="text-base font-semibold mt-1">
          <a href={\`/\${product.categorySlug}/\${product.slug}\`} className="hover:underline">
            {product.name}
          </a>
        </h2>
        <p className="text-sm opacity-80 mt-1">{product.shortSpecs}</p>
      </div>
      <div className="flex items-center justify-between pt-2">
        <span className="text-lg font-bold">₦{product.priceNgn.toLocaleString('en-NG')}</span>
        <span className="text-xs font-medium px-2 py-1 rounded-full border">
          {product.inStock ? 'In Stock' : 'Out of Stock'}
        </span>
      </div>
    </article>
  );
}
`,
      },
      {
        path: 'src/components/FacetBar.tsx',
        content: `
export interface FacetSummary {
  brands: Array<{ value: string; count: number }>;
  conditions: Array<{ value: string; count: number }>;
  totalMatches: number;
}

export function FacetBar({ facets }: { facets: FacetSummary }) {
  return (
    <aside aria-label="Catalog filters" className="rounded-2xl border p-4 space-y-4">
      <p className="text-sm font-semibold">{facets.totalMatches} devices matched</p>
      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide mb-2">Brands</h2>
        <ul className="flex flex-wrap gap-2">
          {facets.brands.map((item) => (
            <li key={item.value} className="text-xs px-2.5 py-1 rounded-lg border">
              {item.value} ({item.count})
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide mb-2">Condition</h2>
        <ul className="flex flex-wrap gap-2">
          {facets.conditions.map((item) => (
            <li key={item.value} className="text-xs px-2.5 py-1 rounded-lg border">
              {item.value} ({item.count})
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
`,
      },
      {
        path: 'src/StorefrontApp.tsx',
        content: `
import './styles/theme.css';
import { FacetBar, type FacetSummary } from './components/FacetBar';
import { ProductCard, type CardProduct } from './components/ProductCard';

export interface StorefrontRenderProps {
  view: 'home' | 'collection' | 'product' | 'search' | 'cart' | 'editorial' | 'not_found';
  pathname: string;
  merchantSlug: string;
  title: string;
  products: CardProduct[];
  facets: FacetSummary;
  productDetail: (CardProduct & {
    variants: Array<{ id: string; label: string; priceNgn: number; inStock: boolean }>;
  }) | null;
}

export default function StorefrontApp(props: StorefrontRenderProps) {
  if (props.view === 'not_found') {
    return (
      <main className="storefront-shell min-h-screen p-8 max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold">Page Not Found</h1>
        <p className="mt-2">The requested product or category could not be found.</p>
        <a href="/" className="inline-block mt-4 underline font-medium">Return to storefront home</a>
      </main>
    );
  }

  if (props.view === 'product' && props.productDetail) {
    const item = props.productDetail;
    return (
      <main className="storefront-shell min-h-screen p-6 max-w-6xl mx-auto">
        <nav aria-label="Breadcrumb" className="text-sm mb-4">
          <ol className="flex gap-2">
            <li><a href="/">Home</a></li>
            <li>/</li>
            <li><a href={\`/\${item.categorySlug}\`}>{item.categorySlug}</a></li>
          </ol>
        </nav>
        <article className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <img src={item.imageUrl} alt={item.imageAlt} width={560} height={560} className="w-full rounded-2xl border p-6" />
          <section className="space-y-4">
            <h1 className="text-3xl font-extrabold">{item.name}</h1>
            <p className="text-2xl font-bold">₦{item.priceNgn.toLocaleString('en-NG')}</p>
            <p className="text-sm opacity-80">{item.shortSpecs}</p>
            <ul className="grid grid-cols-2 gap-2">
              {item.variants.map((variant) => (
                <li key={variant.id} className="rounded-xl border p-3 text-sm">
                  <span className="font-semibold block">{variant.label}</span>
                  <span>₦{variant.priceNgn.toLocaleString('en-NG')}</span>
                </li>
              ))}
            </ul>
            <a
              href={\`https://\${props.merchantSlug}.usebaci.com/checkout\`}
              rel="noopener noreferrer"
              className="accent-cta inline-flex items-center justify-center rounded-xl px-6 py-3 font-semibold"
            >
              Proceed to Trusted Checkout
            </a>
          </section>
        </article>
      </main>
    );
  }

  return (
    <div className="storefront-shell min-h-screen">
      <header className="border-b px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <a href="/" className="text-xl font-black tracking-tight">OGABASSEY</a>
        <nav aria-label="Primary categories">
          <ul className="flex gap-4 text-sm font-medium">
            <li><a href="/smartphones">Smartphones</a></li>
            <li><a href="/laptops">Laptops</a></li>
            <li><a href="/gaming">Gaming</a></li>
            <li><a href="/cart">Cart</a></li>
          </ul>
        </nav>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <section className="rounded-3xl border p-8 flex flex-col gap-3">
          <h1 className="text-4xl font-extrabold tracking-tight">{props.title}</h1>
          <p className="text-base opacity-80 max-w-2xl">
            Verified gadgets with instant nationwide delivery and flexible payment protection.
          </p>
        </section>
        <FacetBar facets={props.facets} />
        <section aria-label="Product catalog">
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {props.products.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
`,
      },
    ],
  };
}
