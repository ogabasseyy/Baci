'use client';

import { Button } from '@/components/ui/button';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import { jumiaGamingDraftPageSchema } from '@/schemas/jumia/selection-draft';
import { GamingSelectionPreviewProducts } from './gaming-selection-preview-products';
import type { JumiaMappingDraft } from './jumia-mapping-draft-panel';
import { JumiaProductPreflightPreview } from './jumia-product-preflight-preview';
import { useGamingSelectionDraft } from './use-gaming-selection-draft';

export function GamingSelectionDraft({
  merchantId,
  snapshot,
  loading,
  onPageChange,
  integrationId,
  mapping,
}: {
  merchantId: string;
  snapshot: JumiaProductExportEligiblePage;
  loading: boolean;
  onPageChange: (page: number) => void;
  integrationId: string;
  mapping: JumiaMappingDraft | null;
}) {
  const selection = useGamingSelectionDraft(merchantId, snapshot);
  const parsedSnapshot = jumiaGamingDraftPageSchema.safeParse(snapshot);
  const busy = loading || selection.progress !== null;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Draft for the forthcoming bulk flow only. These selections are not
        submitted by the existing Submit products action. Only available,
        unchanged products can be selected; refresh the preview after source
        changes.
      </p>
      <p className="text-sm" aria-live="polite">
        {Object.keys(selection.draft).length} selected in draft
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={selection.selectAll}
          disabled={busy || !selection.evidenceValid || snapshot.total === 0}
        >
          Select all eligible
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={selection.clear}
          disabled={
            !selection.progress && Object.keys(selection.draft).length === 0
          }
        >
          Clear draft selection
        </Button>
      </div>
      {selection.progress ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading frozen pages: {selection.progress.completed} of{' '}
          {selection.progress.total}…
        </p>
      ) : null}
      {!selection.evidenceValid ? (
        <p className="text-sm text-amber-700">
          Selection evidence is incomplete or exceeds the draft limit (1,000
          pages / 100,000 products). Refresh the preview before selecting.
        </p>
      ) : null}
      {selection.invalidCount > 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {selection.invalidCount} selected products are no longer valid.
          Deselect them, clear the draft, or refresh the preview.
        </p>
      ) : null}
      {selection.error ? (
        <p role="alert" className="text-sm text-destructive">
          {selection.error}
        </p>
      ) : null}
      <GamingSelectionPreviewProducts
        snapshot={snapshot}
        loading={busy}
        onPageChange={onPageChange}
        selection={selection}
      />
      {parsedSnapshot.success && selection.evidenceValid ? (
        <JumiaProductPreflightPreview
          merchantId={merchantId}
          integrationId={integrationId}
          page={parsedSnapshot.data}
          selectedDraft={selection.draft}
          mapping={mapping}
        />
      ) : (
        <p role="status" className="text-sm text-amber-700">
          Refresh the frozen Gaming preview before checking products.
        </p>
      )}
    </>
  );
}
