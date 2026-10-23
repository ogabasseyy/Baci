'use client';

import { Button } from '@/components/ui/button';
import { jumiaPreviewMessages } from './constants';
import { GamingSelectionPreviewProducts } from './gaming-selection-preview-products';
import { useGamingSelectionPreview } from './use-gaming-selection-preview';

export function GamingSelectionPreview({ merchantId }: { merchantId: string }) {
  const {
    snapshot,
    loading,
    error,
    creationOutcomeUnknown,
    createPreview,
    goToPage,
  } = useGamingSelectionPreview(merchantId);

  return (
    <section
      aria-label="Gaming selection preview"
      className="grid gap-2 rounded-md border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Gaming selection preview</p>
          <p className="text-xs text-muted-foreground">
            Review a frozen selection. Previewing does not submit products to
            Jumia.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              createPreview(creationOutcomeUnknown ? 'retry' : 'create')
            }
            disabled={loading}
            className="w-full sm:w-auto"
          >
            {loading
              ? 'Loading…'
              : creationOutcomeUnknown
                ? 'Retry preview creation'
                : 'Create Gaming preview'}
          </Button>
          {snapshot ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => createPreview('refresh')}
              disabled={loading || creationOutcomeUnknown}
              title={
                creationOutcomeUnknown
                  ? jumiaPreviewMessages.unreadableCreation
                  : undefined
              }
              className="w-full sm:w-auto"
            >
              {loading ? 'Loading…' : 'Refresh preview'}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {snapshot ? (
        <>
          <p className="text-xs text-muted-foreground">
            {snapshot.total} products in this frozen selection
          </p>
          {snapshot.legacyUnmappedCount > 0 ? (
            <p className="text-sm text-amber-700" role="status">
              {snapshot.legacyUnmappedCount} active product
              {snapshot.legacyUnmappedCount === 1 ? ' uses' : 's use'} legacy
              Gaming labels and are not included. Assign them to the active
              Gaming category, then create a new preview.
            </p>
          ) : null}
          <GamingSelectionPreviewProducts
            snapshot={snapshot}
            loading={loading}
            onPageChange={goToPage}
          />
        </>
      ) : null}
    </section>
  );
}
