export const EXPANSION_BEST_FOR_THRESHOLDS = {
  'gaming-laptops': {
    minRamGb: 16,
    maxUnder2mPriceNgn: 2_000_000,
    minScreenSizeInches: 16,
  },
  tablets: {
    maxBudgetPriceNgn: 250_000,
    minBatteryMah: 7000,
    minScreenSizeInches: 10.9,
  },
  audio: {
    budgetMaxPriceNgn: 100_000,
    midrangeMaxPriceNgn: 500_000,
  },
  smartwatches: {
    budgetMaxPriceNgn: 150_000,
    midrangeMaxPriceNgn: 400_000,
  },
  'playstation-5': {
    under50kMaxPriceNgn: 50_000,
    midTierMaxPriceNgn: 120_000,
    upperTierMinPriceNgn: 400_000,
  },
} as const;

export type ExpansionBestForCategorySlug =
  keyof typeof EXPANSION_BEST_FOR_THRESHOLDS;
