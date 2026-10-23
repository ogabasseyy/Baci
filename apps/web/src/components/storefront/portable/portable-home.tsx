import type { CSSProperties, ReactNode } from 'react';
import { getCuratedThemeTokenProjection } from '@/lib/storefront-defaults/curated-theme-token-projection';
import { defaultTheme, type ThemeConfiguration } from '@/lib/theme-config';
import {
  type PortableCatalog,
  type PortableHome,
  type PortableIdentity,
  portableCatalogSchema,
  portableHomeSchema,
  portableIdentitySchema,
} from '@/schemas/portable-storefront';
import { FooterPresentation } from './footer-presentation';
import { HeroPresentation } from './hero-presentation';
import { portableStyles } from './styles';
import { StorefrontTextPresentation } from './text-presentation';

/** Preserve the production token projection; fill partial theme overrides from defaults. */
function mergeTheme(base: unknown, override: unknown): unknown {
  if (!base || typeof base !== 'object' || Array.isArray(base))
    return typeof base === typeof override ? override : base;
  const incoming =
    override && typeof override === 'object'
      ? (override as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [
      key,
      mergeTheme(value, incoming[key]),
    ])
  );
}

type Block = PortableHome['content'][number];
type SharedProps = {
  merchant: PortableIdentity;
  catalog: PortableCatalog;
  inert: boolean;
  basePath: string;
};
function Destination({
  href,
  children,
  inert,
  className,
  basePath,
}: { href: string; children: ReactNode; className?: string } & Pick<
  SharedProps,
  'inert' | 'basePath'
>) {
  // Same element and geometry in both adapters. No href or handler exists in preview.
  return (
    <a
      className={className}
      href={inert ? undefined : `${basePath}${href}`}
      aria-disabled={inert || undefined}
      role={inert ? 'link' : undefined}
    >
      {children}
    </a>
  );
}

function SharedBlock({
  block,
  merchant,
  catalog,
  inert,
  basePath,
}: SharedProps & { block: Block }) {
  const destination = { inert, basePath };
  switch (block.type) {
    case 'Header':
      return (
        <header>
          <div className="baci-header baci-container">
            {block.props.showLogo ? (
              <Destination href="/" {...destination}>
                <strong className="baci-brand">
                  {merchant.logo_url ? (
                    // biome-ignore lint/performance/noImgElement: Explicit native HTTPS image contract shared with the portable widget.
                    <img
                      className="baci-logo"
                      width={120}
                      height={40}
                      src={merchant.logo_url}
                      alt={`${merchant.business_name} logo`}
                    />
                  ) : null}
                  {merchant.business_name}
                </strong>
              </Destination>
            ) : null}
            <nav aria-label="Store navigation">
              {block.props.navigationLinks.map((link) => (
                <Destination key={link.url} href={link.url} {...destination}>
                  {link.label}
                </Destination>
              ))}
            </nav>
          </div>
        </header>
      );
    case 'Hero':
      return (
        <HeroPresentation
          {...block.props}
          action={
            block.props.ctaText ? (
              <Destination
                className="baci-action baci-large"
                href={block.props.ctaLink}
                {...destination}
              >
                {block.props.ctaText}
              </Destination>
            ) : null
          }
        />
      );
    case 'Text':
      return <StorefrontTextPresentation {...block.props} />;
    case 'Button':
      return (
        <div
          className="baci-container"
          style={{ paddingBlock: '1rem', textAlign: block.props.align }}
        >
          <Destination
            className={`baci-action ${block.props.variant === 'accent' ? 'baci-accent' : ''} ${block.props.size === 'sm' ? 'baci-small' : block.props.size === 'lg' ? 'baci-large' : ''}`}
            href={block.props.link}
            {...destination}
          >
            {block.props.text}
          </Destination>
        </div>
      );
    case 'Footer':
      return (
        <FooterPresentation
          brandName={merchant.business_name}
          copyrightText={block.props.copyrightText}
        >
          {block.props.quickLinks.length ? (
            <div>
              <h3>{block.props.quickLinksLabel}</h3>
              <nav aria-label="Footer navigation">
                {block.props.quickLinks.map((link) => (
                  <Destination href={link.url} key={link.url} {...destination}>
                    {link.label}
                  </Destination>
                ))}
              </nav>
            </div>
          ) : null}
        </FooterPresentation>
      );
    case 'ProductGrid':
      return (
        <section className="baci-section baci-container">
          <h2>{block.props.title}</h2>
          <p className="baci-catalog-note">
            Catalog snapshot: {catalog.capturedAt}. Prices are not reserved.
          </p>
          {catalog.products.length ? (
            <div
              className="baci-products"
              style={{ '--baci-columns': block.props.columns } as CSSProperties}
            >
              {catalog.products.slice(0, block.props.limit).map((product) => (
                <article key={product.id}>
                  <Destination
                    href={`/products/${product.slug}`}
                    {...destination}
                  >
                    {product.image ? (
                      // biome-ignore lint/performance/noImgElement: Explicit native HTTPS image contract shared with the portable widget.
                      <img
                        className="baci-product-image"
                        src={product.image}
                        alt={product.name}
                        width={400}
                        height={400}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="baci-product-image"
                        role="img"
                        aria-label="No product image"
                      />
                    )}
                    <div className="baci-product-copy">
                      <h3>{product.name}</h3>
                      <p>
                        {new Intl.NumberFormat('en-NG', {
                          style: 'currency',
                          currency: merchant.currency,
                        }).format(product.price)}
                      </p>
                    </div>
                  </Destination>
                </article>
              ))}
            </div>
          ) : (
            <p>No published products. This catalog is empty.</p>
          )}
        </section>
      );
  }
}

export function PortableHomeView({
  config,
  merchant,
  catalog,
  inert = true,
  basePath = '',
}: {
  config: unknown;
  merchant: unknown;
  catalog: unknown;
  inert?: boolean;
  basePath?: string;
}) {
  const parsed = portableHomeSchema.safeParse(config);
  const identity = portableIdentitySchema.safeParse(merchant);
  const products = portableCatalogSchema.safeParse(catalog);
  if (
    !parsed.success ||
    !identity.success ||
    !products.success ||
    identity.data.id !== products.data.merchantId ||
    !/^$|^\/(?!\/)[a-z0-9-]+$/.test(basePath)
  )
    return (
      <div role="alert">
        Preview unavailable for this homepage capability. Open the authenticated
        Baci editor to review it.
      </div>
    );
  const theme = mergeTheme(
    defaultTheme,
    parsed.data.theme
  ) as ThemeConfiguration;
  return (
    <div
      className="baci-home"
      data-baci-renderer={parsed.data.root.props.rendererVersion}
      style={getCuratedThemeTokenProjection(theme) as CSSProperties}
    >
      <style>{portableStyles}</style>
      {parsed.data.content.map((block) => (
        <div data-baci-block={block.type} key={block.props.id}>
          <SharedBlock
            block={block}
            merchant={identity.data}
            catalog={products.data}
            inert={inert}
            basePath={basePath}
          />
        </div>
      ))}
    </div>
  );
}
