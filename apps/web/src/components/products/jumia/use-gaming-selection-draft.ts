'use client';

import { useEffect, useRef, useState } from 'react';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import {
  type JumiaGamingDraftProduct,
  jumiaGamingDraftPageSchema,
} from '@/schemas/jumia/selection-draft';
import { collectGamingSelectionDraft } from './collect-gaming-selection-draft';

// The renderer is keyed by merchant + immutable selection, so drafts never cross scopes.
export function useGamingSelectionDraft(
  merchantId: string,
  snapshot: JumiaProductExportEligiblePage
) {
  const [draft, setDraft] = useState<Record<string, JumiaGamingDraftProduct>>(
    {}
  );
  const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<{
    generation: number;
    controller?: AbortController;
  }>({ generation: 0 });
  const parsed = jumiaGamingDraftPageSchema.safeParse(snapshot);
  const initial = useRef({
    selectionId: snapshot.selectionId,
    sourceCategoryId: snapshot.sourceCategoryId,
    total: snapshot.total,
    totalPages: snapshot.totalPages,
    limit: snapshot.limit,
  });
  const metadataChanged =
    snapshot.selectionId !== initial.current.selectionId ||
    snapshot.sourceCategoryId !== initial.current.sourceCategoryId ||
    snapshot.total !== initial.current.total ||
    snapshot.totalPages !== initial.current.totalPages ||
    snapshot.limit !== initial.current.limit;
  const evidenceValid = parsed.success && !metadataChanged;
  const eligible = new Map<string, JumiaGamingDraftProduct>();
  if (parsed.success && evidenceValid) {
    for (const item of parsed.data.products) {
      if (
        item.available &&
        !invalidIds.has(item.id) &&
        item.capturedSourceVersion === item.currentSourceVersion
      ) {
        eligible.set(item.id, {
          id: item.id,
          sourceCategoryId: parsed.data.sourceCategoryId,
          capturedSourceVersion: item.capturedSourceVersion,
        });
      }
    }
  }
  const observedInvalid = snapshot.products
    .filter(
      (item) =>
        draft[item.id] &&
        (!eligible.has(item.id) ||
          eligible.get(item.id)?.capturedSourceVersion !==
            draft[item.id].capturedSourceVersion)
    )
    .map((item) => item.id);
  const invalidCount = new Set(
    [
      ...invalidIds,
      ...observedInvalid,
      ...Object.values(draft)
        .filter(
          (entry) =>
            !evidenceValid ||
            !parsed.success ||
            entry.sourceCategoryId !== parsed.data.sourceCategoryId
        )
        .map((entry) => entry.id),
    ].filter((id) => draft[id])
  ).size;

  useEffect(() => {
    return () => {
      operation.current.generation++;
      operation.current.controller?.abort();
    };
  }, []);

  useEffect(() => {
    // Remember invalid observations even after navigating away from that page.
    const result = jumiaGamingDraftPageSchema.safeParse(snapshot);
    setInvalidIds((previous) => {
      const next = new Set(previous);
      for (const entry of Object.values(draft)) {
        if (
          metadataChanged ||
          !result.success ||
          entry.sourceCategoryId !== result.data.sourceCategoryId
        )
          next.add(entry.id);
      }
      for (const item of snapshot.products) {
        const entry = draft[item.id];
        if (
          (result.success &&
            (!item.available ||
              item.currentSourceVersion !== item.capturedSourceVersion)) ||
          (entry &&
            (!result.success ||
              !item.available ||
              item.currentSourceVersion !== entry.capturedSourceVersion ||
              item.capturedSourceVersion !== entry.capturedSourceVersion))
        )
          next.add(item.id);
      }
      return next.size === previous.size ? previous : next;
    });
  }, [snapshot, draft, metadataChanged]);

  function cancel() {
    operation.current.generation++;
    operation.current.controller?.abort();
    operation.current.controller = undefined;
    setProgress(null);
    setError(null);
  }

  function toggle(id: string) {
    cancel();
    setDraft((previous) => {
      const next = { ...previous };
      if (next[id]) delete next[id];
      else {
        const entry = eligible.get(id);
        if (entry) next[id] = entry;
      }
      return next;
    });
  }

  function clear() {
    cancel();
    setDraft({});
  }

  async function selectAll() {
    cancel();
    const generation = operation.current.generation;
    const controller = new AbortController();
    operation.current.controller = controller;
    setProgress({ completed: 0, total: Math.max(1, snapshot.totalPages) });
    const isCurrent = () =>
      !controller.signal.aborted && operation.current.generation === generation;
    try {
      if (!evidenceValid) throw new Error('Frozen selection metadata changed.');
      const result = await collectGamingSelectionDraft(
        merchantId,
        snapshot,
        controller.signal,
        (completed, total) => {
          if (isCurrent()) setProgress({ completed, total });
        },
        (page) => {
          if (isCurrent())
            setInvalidIds((previous) => {
              const next = new Set(previous);
              for (const item of page.products) {
                const selected = draft[item.id];
                const known =
                  selected ??
                  snapshot.products.find((row) => row.id === item.id);
                if (
                  !item.available ||
                  item.currentSourceVersion !== item.capturedSourceVersion ||
                  (known &&
                    known.capturedSourceVersion !==
                      item.capturedSourceVersion) ||
                  (selected &&
                    selected.sourceCategoryId !== page.sourceCategoryId)
                )
                  next.add(item.id);
              }
              return next;
            });
        }
      );
      if (!isCurrent()) return;
      const collected = new Map(result.products.map((item) => [item.id, item]));
      const seen = new Set([...collected.keys(), ...result.ineligibleIds]);
      const inconsistent = Object.values(draft).filter(
        (entry) =>
          !seen.has(entry.id) ||
          (collected.has(entry.id) &&
            (collected.get(entry.id)?.capturedSourceVersion !==
              entry.capturedSourceVersion ||
              collected.get(entry.id)?.sourceCategoryId !==
                entry.sourceCategoryId))
      );
      if (inconsistent.length > 0) {
        setInvalidIds(
          (previous) =>
            new Set([...previous, ...inconsistent.map((entry) => entry.id)])
        );
        throw new Error('Previously selected frozen membership changed.');
      }
      setDraft((previous) => {
        const next = { ...previous };
        for (const item of result.products)
          if (!invalidIds.has(item.id)) next[item.id] ??= item;
        return next;
      });
      setInvalidIds(
        (previous) => new Set([...previous, ...result.ineligibleIds])
      );
    } catch {
      if (isCurrent())
        setError(
          'Draft unchanged. Unable to read all frozen pages. Retry Select all eligible or refresh the preview.'
        );
    } finally {
      if (isCurrent()) {
        operation.current.controller = undefined;
        setProgress(null);
      }
    }
  }

  return {
    draft,
    blockedIds: invalidIds,
    invalidCount,
    progress,
    error,
    evidenceValid,
    eligible,
    toggle,
    clear,
    selectAll,
  };
}
