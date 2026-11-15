import { AdUnit } from './AdUnit';

interface ProductGridAdBreakProps {
  /** Unique per ad on the page, so every repeat requests its own ad. */
  slotInstance: string;
  viewMode: 'grid' | 'list';
}

/** The full-width ad row inserted between products in a product grid. */
export function ProductGridAdBreak({
  slotInstance,
  viewMode,
}: ProductGridAdBreakProps) {
  return (
    <div
      className={`col-span-2 ${viewMode === 'grid' ? 'lg:col-span-4' : 'w-full'} flex items-center justify-center my-2 md:my-4`}
      data-testid="product-grid-ad-break"
    >
      <AdUnit placementKey="PRODUCT_GRID_MPU" slotInstance={slotInstance} />
    </div>
  );
}
