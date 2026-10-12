import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { customerSavingsDrafts } from '@/lib/customer-savings-drafts';
import { savingsDraftRequestId } from '@/lib/savings-draft-request-id';
import type { SavingsDraft } from '@/schemas/customer-savings-drafts';

export function useLocalSavingsDrafts(scope: {
  userId: string;
  merchantId: string;
}) {
  const [drafts, setDrafts] = useState<SavingsDraft[]>([]);
  const [draft, setDraft] = useState<SavingsDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewRequestId, setReviewRequestId] = useState<string | null>(null);
  const [retrySelection, setRetrySelection] = useState<{
    productId: string;
    variantId: string | null;
  } | null>(null);
  const active = useRef(false);
  const pending = useRef(false);
  const generation = useRef(0);

  async function run(operation: (current: () => boolean) => Promise<void>) {
    if (pending.current || !active.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const revision = ++generation.current;
    const current = () => active.current && revision === generation.current;
    try {
      await operation(current);
    } catch (failure) {
      if (current()) {
        const review =
          failure instanceof Error &&
          'code' in failure &&
          failure.code === 'SAVINGS_DRAFT_REVIEW_REQUIRED' &&
          'status' in failure &&
          failure.status === 409;
        if (review && draft?.consent === 'required')
          setReviewRequestId(draft.requestId);
        setError(
          review
            ? 'This saved draft is no longer current. Start a new draft to review the latest catalogue and disclosure.'
            : 'We could not save or load your draft. Please retry; your request is retained.'
        );
      }
    } finally {
      if (current()) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  function publish(value: SavingsDraft) {
    if (!active.current) return;
    setDraft(value);
    setRetrySelection(null);
    setDrafts((current) => [
      value,
      ...current.filter((item) => item.draftId !== value.draftId),
    ]);
  }
  const reload = () =>
    run(async (current) => {
      const result = await customerSavingsDrafts.list(scope);
      if (current()) setDrafts(result);
    });
  const initialReload = useEffectEvent(reload);
  useEffect(() => {
    active.current = true;
    void initialReload();
    return () => {
      active.current = false;
      pending.current = false;
      generation.current++;
    };
  }, []);

  async function loadSelection(
    productId: string,
    variantId: string | null,
    current: () => boolean,
    expectedOldRequestId?: string
  ) {
    const requestId = await savingsDraftRequestId(
      { ...scope, productId, variantId },
      expectedOldRequestId
    );
    if (!current()) return;
    if (expectedOldRequestId !== undefined) {
      setDraft(null);
      setReviewRequestId(null);
      setRetrySelection({ productId, variantId });
    }
    const retained = await customerSavingsDrafts.list(scope, requestId);
    if (!current()) return;
    const value =
      retained[0] ??
      (await customerSavingsDrafts.create(scope, {
        productId,
        variantId,
        requestId,
      }));
    if (current()) publish(value);
  }

  return {
    drafts,
    draft,
    busy,
    error,
    canStartNewDraft: !!draft && reviewRequestId === draft.requestId,
    canRetryCreation: retrySelection !== null,
    reload,
    close: () => {
      if (!pending.current) setDraft(null);
    },
    open: (selected: SavingsDraft) =>
      run(async (current) => {
        const value = await customerSavingsDrafts.read(scope, selected.draftId);
        if (current()) publish(value);
      }),
    create: (productId: string, variantId: string | null) =>
      run((current) => loadSelection(productId, variantId, current)),
    startNewDraft: () =>
      run(async (current) => {
        if (!draft || reviewRequestId !== draft.requestId) return;
        await loadSelection(
          draft.productId,
          draft.variantId,
          current,
          draft.requestId
        );
      }),
    retryCreation: () =>
      run(async (current) => {
        if (retrySelection)
          await loadSelection(
            retrySelection.productId,
            retrySelection.variantId,
            current
          );
      }),
    accept: () =>
      run(async (current) => {
        if (!draft) return;
        setReviewRequestId(null);
        const value = await customerSavingsDrafts.accept(scope, draft);
        if (current()) publish(value);
      }),
  };
}
