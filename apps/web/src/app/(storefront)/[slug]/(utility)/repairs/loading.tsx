import { RepairsLabHero } from '@/components/storefront/ogabassey/pages/repairs-lab-hero';

export default function RepairsLoading() {
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
