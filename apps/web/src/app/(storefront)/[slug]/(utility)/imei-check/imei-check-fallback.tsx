import { ImeiCheckerHero } from '@/components/storefront/ogabassey/pages/imei-checker-hero';

export function ImeiCheckFallback() {
  return (
    <div
      role="status"
      aria-label="Loading IMEI checker"
      aria-live="polite"
      className="px-4 pt-12"
    >
      <ImeiCheckerHero />
    </div>
  );
}
