import { BannerCarousel } from './product-details-lazy-banner-carousel';

interface ProductDetailsBannerSectionProps {
  isDesktop: boolean;
}

export function ProductDetailsBannerSection({
  isDesktop,
}: ProductDetailsBannerSectionProps) {
  return (
    <section
      aria-label="Product banner carousel"
      className="mx-auto mb-8 hidden min-h-[208px] max-w-[1400px] px-4 md:block md:px-6"
    >
      {isDesktop ? <BannerCarousel className="h-40 md:h-52" /> : null}
    </section>
  );
}
