import { RepairsLabHero } from '@/components/storefront/ogabassey/pages/repairs-lab-hero';

interface RepairsLabFallbackProps {
  hideHero?: boolean;
}

export function RepairsLabFallback({
  hideHero = true,
}: RepairsLabFallbackProps) {
  if (hideHero) {
    return (
      <div
        role="status"
        aria-label="Loading repair lab"
        aria-live="polite"
        className="px-4 py-8 text-sm text-store-background-text"
      >
        Loading repair lab
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="Loading repair lab"
      aria-live="polite"
      className="min-h-screen bg-store-secondary pb-24 md:pb-12 pt-4 md:pt-8"
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full">
        <RepairsLabHero />
      </div>
    </div>
  );
}
