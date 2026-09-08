import { ImeiCheckerHero } from '@/components/storefront/ogabassey/pages/imei-checker-hero';

export function ImeiCheckFallback() {
  return (
    <div
      role="status"
      aria-label="Loading IMEI checker"
      aria-live="polite"
      className="min-h-screen bg-linear-to-b from-gray-50 to-white pb-24 md:pb-12 pt-4 md:pt-8 flex flex-col"
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full flex-1">
        <ImeiCheckerHero />
      </div>
    </div>
  );
}
