import {
  buildGamingLaptopGraphicsHubPath,
  type GamingLaptopGraphicsHub,
} from '@/lib/storefront-category/gaming-laptop-graphics-hubs';

interface GamingGraphicsHubIntroProps {
  availableHubs: GamingLaptopGraphicsHub[];
  categorySlug: string;
  countryName: string;
  currentHub: GamingLaptopGraphicsHub;
  merchantName: string;
  productCount: number;
  storeUrl: string;
}

export function GamingGraphicsHubIntro({
  availableHubs,
  categorySlug,
  countryName,
  currentHub,
  merchantName,
  productCount,
  storeUrl,
}: GamingGraphicsHubIntroProps) {
  const otherHubs = availableHubs.filter(
    (candidate) => candidate.slug !== currentHub.slug
  );

  return (
    <section className="bg-store-background text-store-background-text">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <nav
          aria-label="Breadcrumb"
          className="text-sm text-store-background-text/65"
        >
          <a href={`${storeUrl}/${categorySlug}`} className="hover:underline">
            Gaming laptops
          </a>{' '}
          / {currentHub.label}
        </nav>
        <header className="max-w-4xl space-y-4">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {currentHub.label} Gaming Laptops in {countryName}
          </h1>
          <p className="text-base leading-7 text-store-background-text/75 sm:text-lg">
            Compare {productCount} currently listed {currentHub.label} gaming
            laptops from {merchantName}. Review each model's processor, graphics
            memory, display, RAM, storage, condition, price and availability
            before choosing the configuration that fits your games and workload.
          </p>
          <p className="text-sm leading-7 text-store-background-text/70">
            The GPU name alone does not determine laptop performance. Cooling,
            graphics power limits, CPU pairing and display resolution can change
            real-world results, so use the verified specifications on each
            product page rather than assuming every {currentHub.label} laptop is
            configured the same way.
          </p>
        </header>

        {otherHubs.length > 0 ? (
          <nav
            aria-label="Other gaming laptop graphics hubs"
            className="space-y-3"
          >
            <h2 className="text-lg font-semibold">Compare other RTX ranges</h2>
            <ul className="flex flex-wrap gap-2">
              {otherHubs.map((hub) => (
                <li key={hub.slug}>
                  <a
                    href={`${storeUrl}${buildGamingLaptopGraphicsHubPath(
                      categorySlug,
                      hub.slug
                    )}`}
                    className="inline-flex rounded-full border border-store-border px-4 py-2 text-sm font-medium hover:border-store-primary hover:text-store-primary"
                  >
                    {hub.label} laptops
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </section>
  );
}
