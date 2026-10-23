'use client';

import { Button } from '@/components/ui/button';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';

export function GamingSelectionPreviewProducts({
  snapshot,
  loading,
  onPageChange,
}: {
  snapshot: JumiaProductExportEligiblePage;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <>
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading products…
        </p>
      ) : null}
      {!loading && snapshot.products.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No products in this Gaming selection.
        </p>
      ) : null}
      <ul className="grid max-h-[40vh] gap-1 overflow-y-auto">
        {snapshot.products.map((item) => {
          const name =
            item.product?.product?.name?.trim() ||
            (item.available
              ? 'Unnamed product'
              : `Unavailable product (${item.id})`);
          const reason =
            item.unavailableReason?.replaceAll('_', ' ') ??
            'No longer eligible';
          return (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded px-2 py-1 text-sm"
            >
              <span>{name}</span>
              {!item.available ? (
                <span className="text-xs text-destructive">{reason}</span>
              ) : null}
              {item.available &&
              item.capturedSourceVersion !== item.currentSourceVersion ? (
                <span className="text-xs text-amber-700">
                  Changed since preview; showing current details.
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={loading || snapshot.page <= 1}
          onClick={() => onPageChange(snapshot.page - 1)}
          className="w-full sm:w-auto"
        >
          Previous page
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {snapshot.page} of {snapshot.totalPages || 1}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={loading || snapshot.page >= snapshot.totalPages}
          onClick={() => onPageChange(snapshot.page + 1)}
          className="w-full sm:w-auto"
        >
          Next page
        </Button>
      </div>
    </>
  );
}
