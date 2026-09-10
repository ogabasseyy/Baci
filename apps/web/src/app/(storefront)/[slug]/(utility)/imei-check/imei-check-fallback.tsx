import { ImeiCheckerHero } from '@/components/storefront/ogabassey/pages/imei-checker-hero';

interface ImeiCheckFallbackProps {
  hideHero?: boolean;
}

export function ImeiCheckFallback({
  hideHero = false,
}: ImeiCheckFallbackProps) {
  return (
    <div
      role="status"
      aria-label="Loading IMEI checker"
      aria-live="polite"
      className={
        hideHero
          ? undefined
          : 'flex min-h-screen flex-col bg-linear-to-b from-gray-50 to-white pb-24 pt-4 md:pb-12 md:pt-8'
      }
    >
      {hideHero ? null : (
        <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 md:px-6">
          <ImeiCheckerHero />
        </div>
      )}
    </div>
  );
}
