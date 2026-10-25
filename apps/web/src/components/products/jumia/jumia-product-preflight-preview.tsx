'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchWithCsrf } from '@/lib/api-client';
import type { JumiaProductPreflightResponse } from '@/schemas/jumia/product-preflight';
import { jumiaProductPreflightRequestSchema } from '@/schemas/jumia/product-preflight';
import type {
  JumiaGamingDraftPage,
  JumiaGamingDraftProduct,
} from '@/schemas/jumia/selection-draft';
import type { JumiaMappingDraft } from './jumia-mapping-draft-panel';
import {
  getSafePreflightError,
  validateJumiaPreflightResponse,
} from './jumia-product-preflight-response';

type PreviewState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error'; error: string }
  | {
      key: string;
      status: 'success';
      result: JumiaProductPreflightResponse;
    };

type Props = {
  merchantId: string;
  integrationId: string;
  page: JumiaGamingDraftPage;
  selectedDraft: Readonly<Record<string, JumiaGamingDraftProduct>>;
  mapping: JumiaMappingDraft | null;
};

export function JumiaProductPreflightPreview({
  merchantId,
  integrationId,
  page,
  selectedDraft,
  mapping,
}: Props) {
  const selectedCount = Object.keys(selectedDraft).length;
  const currentPageSelection = page.products.flatMap((item) => {
    const selected = selectedDraft[item.id];
    if (
      !selected ||
      !item.available ||
      item.currentSourceVersion !== item.capturedSourceVersion ||
      selected.capturedSourceVersion !== item.capturedSourceVersion ||
      selected.sourceCategoryId !== page.sourceCategoryId
    )
      return [];
    return [{ productId: item.id, sourceVersion: item.capturedSourceVersion }];
  });
  const sameDestination =
    mapping?.merchantId === merchantId &&
    mapping.integrationId === integrationId &&
    mapping.countryCode.toUpperCase() === 'NG';
  const bulletsValid =
    mapping !== null &&
    mapping.bullets.length >= 4 &&
    mapping.bullets.length <= 7 &&
    mapping.bullets.every((bullet) => bullet.trim().length > 0);
  const readyMapping = Boolean(
    mapping &&
      sameDestination &&
      mapping.categoryConfirmed &&
      bulletsValid &&
      mapping.businessClientCode &&
      mapping.category.code > 0 &&
      mapping.brand.code > 0
  );
  const requestBody =
    mapping && readyMapping && currentPageSelection.length > 0
      ? {
          merchantId,
          integrationId,
          businessClientCode: mapping.businessClientCode,
          selectionId: page.selectionId,
          sourceCategoryId: page.sourceCategoryId,
          sourcePage: { page: page.page, limit: page.limit },
          products: currentPageSelection,
          mappings: currentPageSelection.map(({ productId }) => ({
            productId,
            category: {
              code: mapping.category.code,
              name: mapping.category.name,
            },
            brand: { code: mapping.brand.code, name: mapping.brand.name },
            attributeSetId: mapping.attributeSetId,
            attributes: Object.fromEntries(
              Object.entries(mapping.attributes).filter(
                ([, value]) => value !== undefined
              )
            ),
            bullets: mapping.bullets,
            ...(mapping.variation ? { variation: mapping.variation } : {}),
            categoryConfirmed: true as const,
          })),
        }
      : null;
  const parsedRequest = requestBody
    ? jumiaProductPreflightRequestSchema.safeParse(requestBody)
    : null;
  const selectedDraftScope = Object.values(selectedDraft)
    .map((selected) => [
      selected.id,
      selected.sourceCategoryId,
      selected.capturedSourceVersion,
    ])
    .sort((left, right) => left[0].localeCompare(right[0]));
  const requestKey = JSON.stringify([
    merchantId,
    integrationId,
    page.selectionId,
    page.sourceCategoryId,
    page.page,
    page.limit,
    currentPageSelection,
    selectedDraftScope,
    mapping,
  ]);
  const [state, setState] = useState<PreviewState | null>(null);
  const [confirmedScopeKey, setConfirmedScopeKey] = useState<string | null>(
    null
  );
  const operation = useRef<{
    generation: number;
    controller: AbortController | null;
  }>({ generation: 0, controller: null });
  const effectKey = useRef(requestKey);
  const visibleState = state?.key === requestKey ? state : null;

  useEffect(() => {
    effectKey.current = requestKey;
    operation.current.generation += 1;
    operation.current.controller?.abort();
    operation.current.controller = null;
    setState(null);
    setConfirmedScopeKey(null);
    return () => {
      operation.current.generation += 1;
      operation.current.controller?.abort();
      operation.current.controller = null;
    };
  }, [requestKey]);

  async function checkSelectedPage() {
    if (!parsedRequest?.success || visibleState?.status === 'loading') return;
    operation.current.controller?.abort();
    const controller = new AbortController();
    operation.current.controller = controller;
    const generation = ++operation.current.generation;
    setState({ key: requestKey, status: 'loading' });
    try {
      const response = await fetchWithCsrf(
        '/api/marketplace/jumia/products/preflight',
        {
          method: 'POST',
          body: JSON.stringify(parsedRequest.data),
          signal: controller.signal,
        }
      );
      const payload: unknown = await response.json().catch(() => null);
      if (
        controller.signal.aborted ||
        operation.current.generation !== generation
      )
        return;
      if (!response.ok) {
        setState({
          key: requestKey,
          status: 'error',
          error:
            getSafePreflightError(payload) ??
            'Unable to check these selected products.',
        });
        return;
      }
      const result = validateJumiaPreflightResponse(
        payload,
        parsedRequest.data
      );
      if (!result.success) {
        setState({
          key: requestKey,
          status: 'error',
          error: result.error,
        });
        return;
      }
      setState({ key: requestKey, status: 'success', result: result.result });
    } catch {
      if (
        !controller.signal.aborted &&
        operation.current.generation === generation
      ) {
        setState({
          key: requestKey,
          status: 'error',
          error: 'Unable to check these selected products. Retry the preview.',
        });
      }
    } finally {
      if (operation.current.generation === generation)
        operation.current.controller = null;
    }
  }

  const result =
    visibleState?.status === 'success' ? visibleState.result : null;
  const checkedCount = result?.scope.productIds.length ?? 0;
  const remainingCount = Math.max(0, selectedCount - checkedCount);
  const canCheck =
    Boolean(parsedRequest?.success) &&
    confirmedScopeKey === requestKey &&
    visibleState?.status !== 'loading';

  return (
    <section
      aria-label="Jumia read-only product preflight"
      className="grid gap-2 rounded-md border border-dashed p-3"
    >
      <div>
        <h4 className="text-sm font-medium">Read-only Jumia preflight</h4>
        <p className="text-xs text-muted-foreground">
          Checks only eligible selected products on the visible page. This
          preview never submits products and cannot enable publishing.
        </p>
      </div>
      <p className="text-xs" aria-live="polite">
        {checkedCount} checked of {currentPageSelection.length} selected on this
        page · {remainingCount} selected products remain unpreviewed
      </p>
      {currentPageSelection.length === 0 ? (
        <p role="status" className="text-sm text-amber-700">
          {selectedCount === 0
            ? 'Select at least one eligible product on this page before checking the preview.'
            : 'No selected product on this page still matches its frozen source version. Move to a page with selected products or refresh the frozen selection.'}
        </p>
      ) : null}
      {mapping?.categoryConfirmed &&
      sameDestination &&
      bulletsValid &&
      currentPageSelection.length > 0 &&
      confirmedScopeKey !== requestKey ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirmedScopeKey(requestKey)}
        >
          Confirm mapping for this selected page
        </Button>
      ) : null}
      {!mapping || !sameDestination ? (
        <p role="status" className="text-sm text-amber-700">
          Choose a Nigeria destination and complete the mapping draft for this
          merchant and integration before checking products.
        </p>
      ) : !mapping.categoryConfirmed ? (
        <p role="status" className="text-sm text-amber-700">
          Confirm the exact draft category before checking products.
        </p>
      ) : !bulletsValid ? (
        <p role="alert" className="text-sm text-destructive">
          Enter four to seven nonempty plain-text product bullets.
        </p>
      ) : null}
      {requestBody && parsedRequest && !parsedRequest.success ? (
        <p role="alert" className="text-sm text-destructive">
          Review the selected-page mapping fields before checking products:{' '}
          {parsedRequest.error.issues
            .slice(0, 3)
            .map((issue) => issue.path.join('.') || 'request')
            .join(', ')}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        onClick={checkSelectedPage}
        disabled={!canCheck}
      >
        {visibleState?.status === 'loading'
          ? 'Checking selected products…'
          : 'Check selected products on this page'}
      </Button>
      {visibleState?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {visibleState.error}
        </p>
      ) : null}
      {result ? (
        <div className="grid gap-2" role="status" aria-live="polite">
          <p className="text-sm">
            Checked {checkedCount} of {selectedCount} selected draft products.
            Digest: <code>{result.digest}</code>
          </p>
          {result.products.map((product) => (
            <div key={product.productId} className="rounded bg-muted/40 p-2">
              <p className="text-sm font-medium">Product {product.productId}</p>
              {product.blockers.length ? (
                <ul className="list-disc pl-5 text-xs text-amber-800">
                  {product.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No local blockers found. External evidence remains required.
                </p>
              )}
            </div>
          ))}
          <p className="text-sm font-medium">canSubmit: false</p>
        </div>
      ) : null}
    </section>
  );
}
