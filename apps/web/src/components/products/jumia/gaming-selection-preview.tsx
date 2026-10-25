'use client';

import { Button } from '@/components/ui/button';
import { jumiaPreviewMessages } from './constants';
import { GamingSelectionDraft } from './gaming-selection-draft';
import type { JumiaMappingDraft } from './jumia-mapping-draft-panel';
import { useGamingSelectionPreview } from './use-gaming-selection-preview';

export function GamingSelectionPreview({
  merchantId,
  integrationId = '',
  mapping = null,
}: {
  merchantId: string;
  integrationId?: string;
  mapping?: JumiaMappingDraft | null;
}) {
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
          {snapshot || error ? (
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
            {snapshot.total} {snapshot.total === 1 ? 'product' : 'products'} in
            this frozen selection
          </p>
          {snapshot.legacyUnmappedCount > 0 ? (
            <p className="text-sm text-amber-700" role="status">
              {snapshot.legacyUnmappedCount === 1
                ? '1 active product uses a legacy Gaming label and is not included. Assign it to the active Gaming category, then create a new preview.'
                : `${snapshot.legacyUnmappedCount} active products use legacy Gaming labels and are not included. Assign them to the active Gaming category, then create a new preview.`}
            </p>
          ) : null}
          <GamingSelectionDraft
            key={`${merchantId}:${snapshot.selectionId}`}
            merchantId={merchantId}
            snapshot={snapshot}
            loading={loading}
            onPageChange={goToPage}
            integrationId={integrationId}
            mapping={mapping}
          />
        </>
      ) : null}
    </section>
  );
}
