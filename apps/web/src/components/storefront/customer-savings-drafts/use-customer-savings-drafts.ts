'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createCustomerSavingsDraftBrowser } from '@/lib/customer-savings-draft-browser';
import { customerSavingsDraftBrowserRequestId } from '@/lib/customer-savings-draft-browser-request-id';
import type {
  CustomerSavingsDraft,
  CustomerSavingsDraftProduct,
  CustomerSavingsDraftScope,
  CustomerSavingsDraftSelection,
} from '@/schemas/customer-savings-draft-public';

type BrowserClient = ReturnType<typeof createCustomerSavingsDraftBrowser>;
export function useCustomerSavingsDrafts(scope: CustomerSavingsDraftScope) {
  const { merchantId, userId } = scope;
  const [drafts, setDrafts] = useState<CustomerSavingsDraft[]>([]);
  const [products, setProducts] = useState<CustomerSavingsDraftProduct[]>([]);
  const [draft, setDraft] = useState<CustomerSavingsDraft | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const [retained, setRetained] =
    useState<CustomerSavingsDraftSelection | null>(null);
  const [cataloguePage, setCataloguePage] = useState({ search: '', page: 0 });
  const apiRef = useRef<BrowserClient | null>(null);
  const active = useRef(false);
  const pending = useRef(false);
  const generation = useRef(0);

  async function run(
    operation: (api: BrowserClient, current: () => boolean) => Promise<void>
  ) {
    const api = apiRef.current;
    if (!api || !active.current || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const revision = ++generation.current;
    const current = () => active.current && generation.current === revision;
    try {
      await operation(api, current);
    } catch (failure) {
      if (current()) {
        const stale =
          failure instanceof Error &&
          'code' in failure &&
          failure.code === 'SAVINGS_DRAFT_REVIEW_REQUIRED' &&
          'status' in failure &&
          failure.status === 409;
        if (stale && draft?.consent === 'required') setReview(draft.requestId);
        setError(
          stale
            ? 'This saved draft is no longer current. Start a new draft to review current details.'
            : 'Unable to load or save. Please retry; your request is retained.'
        );
      }
    } finally {
      if (current()) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  const refresh = () =>
    run(async (api, current) => {
      const [saved, catalogue] = await Promise.all([
        api.list(),
        api.catalogue(),
      ]);
      if (current()) {
        setDrafts(saved);
        setProducts(catalogue);
        setCataloguePage({ search: '', page: 0 });
      }
    });
  const initialLoad = useEffectEvent(refresh);
  useEffect(() => {
    active.current = true;
    const invalidate = () => {
      if (!active.current) return;
      active.current = false;
      generation.current++;
      pending.current = false;
      setExpired(true);
      setDraft(null);
      setDrafts([]);
      setProducts([]);
      setBusy(false);
    };
    try {
      apiRef.current = createCustomerSavingsDraftBrowser(
        { merchantId, userId },
        invalidate
      );
      void initialLoad();
    } catch {
      invalidate();
    }
    return () => {
      active.current = false;
      generation.current++;
      pending.current = false;
      apiRef.current?.close();
      apiRef.current = null;
    };
  }, [merchantId, userId]);

  function publish(value: CustomerSavingsDraft) {
    setDraft(value);
    setRetained(null);
    setDrafts((saved) => [
      value,
      ...saved.filter((entry) => entry.draftId !== value.draftId),
    ]);
  }
  async function load(
    api: BrowserClient,
    current: () => boolean,
    selection: CustomerSavingsDraftSelection,
    previous?: string
  ) {
    const requestId = await customerSavingsDraftBrowserRequestId(
      scope,
      selection,
      previous
    );
    if (!current()) return;
    setRetained(selection);
    setDraft(null);
    setReview(null);
    const recovered = await api.list(requestId);
    if (!current()) return;
    const value =
      recovered[0] ?? (await api.create({ ...selection, requestId }));
    if (
      value.requestId !== requestId ||
      value.productId !== selection.productId ||
      value.variantId !== selection.variantId
    )
      throw new Error('Draft selection mismatch.');
    if (current()) publish(value);
  }
  return {
    drafts,
    products,
    draft,
    busy,
    error,
    expired,
    cataloguePage,
    canReplace: draft !== null && draft.requestId === review,
    canRetry: retained !== null,
    refresh,
    search: (search: string, page = 0) =>
      run(async (api, current) => {
        const result = await api.catalogue(search, page);
        if (current()) {
          setProducts(result);
          setCataloguePage({ search, page });
        }
      }),
    close: () => {
      if (!pending.current) setDraft(null);
    },
    open: (draftId: string) =>
      run(async (api, current) => {
        const result = await api.read(draftId);
        if (current()) publish(result);
      }),
    create: (selection: CustomerSavingsDraftSelection) =>
      run((api, current) => load(api, current, selection)),
    replace: () =>
      run(async (api, current) => {
        if (draft && review === draft.requestId)
          await load(
            api,
            current,
            { productId: draft.productId, variantId: draft.variantId },
            draft.requestId
          );
      }),
    retry: () =>
      run(async (api, current) => {
        if (retained) await load(api, current, retained);
      }),
    accept: () =>
      run(async (api, current) => {
        if (!draft) return;
        setReview(null);
        const result = await api.accept(draft);
        if (current()) publish(result);
      }),
  };
}
