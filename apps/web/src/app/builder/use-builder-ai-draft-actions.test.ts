import { act, renderHook, waitFor } from '@testing-library/react';
import {
  createElement,
  Suspense,
  startTransition,
  useLayoutEffect,
} from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { applyAiDraftRequest } from './apply-ai-draft-request';
import type { BuilderToast } from './builder-client-types';
import { useBuilderAiDraftActions } from './use-builder-ai-draft-actions';

type BuilderAiDraftActionsParams = Parameters<
  typeof useBuilderAiDraftActions
>[0];

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
vi.mock('./apply-ai-draft-request', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./apply-ai-draft-request')>();
  return { ...actual, applyAiDraftRequest: vi.fn(actual.applyAiDraftRequest) };
});

const mockApplyAiDraftRequest = vi.mocked(applyAiDraftRequest);
const mockFetchWithCsrf = vi.mocked(fetchWithCsrf);

const builderData: BuilderAiDraftActionsParams['data'] = {
  content: [],
  root: {},
  zones: {},
};

function createRouter(): BuilderAiDraftActionsParams['router'] {
  return {
    back: vi.fn(),
    bfcacheId: 'test-bfcache-id',
    forward: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  } satisfies BuilderAiDraftActionsParams['router'];
}

function createParams(
  overrides: Partial<BuilderAiDraftActionsParams> = {}
): BuilderAiDraftActionsParams {
  return {
    aiDraftJobId: 'job-a',
    canApplyAiDraft: true,
    canEdit: true,
    data: builderData,
    degradedReason: null,
    merchantId: 'merchant-a',
    previewMode: 'ai_draft',
    router: createRouter(),
    setAiDraftJobId: vi.fn(),
    setApplyingAiDraft: vi.fn(),
    setCanApplyAiDraft: vi.fn(),
    setCanEdit: vi.fn(),
    setData: vi.fn(),
    setDegradedReason: vi.fn(),
    setIsAiLoading: vi.fn(),
    setLastUpdated: vi.fn(),
    setPreviewMode: vi.fn(),
    setShowStaleAiDraftDialog: vi.fn(),
    toast: vi.fn<BuilderToast>(),
    ...overrides,
  };
}

describe('useBuilderAiDraftActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('explains that a merchant must be selected before applying an AI draft', async () => {
    const toast = vi.fn<BuilderToast>();
    const { result } = renderHook(() =>
      useBuilderAiDraftActions(
        createParams({
          merchantId: null,
          toast,
        })
      )
    );

    await act(async () => {
      await result.current.applyAiDraft();
    });

    expect(toast).toHaveBeenCalledWith({
      title: 'No merchant selected',
      description: 'Select a merchant before using the AI builder.',
      variant: 'destructive',
    });
    expect(mockApplyAiDraftRequest).not.toHaveBeenCalled();
  });

  it('explains that a merchant must be selected before running an AI command', async () => {
    const toast = vi.fn<BuilderToast>();
    const { result } = renderHook(() =>
      useBuilderAiDraftActions(
        createParams({
          merchantId: null,
          toast,
        })
      )
    );

    await act(async () => {
      await result.current.handleAiCommand('Make the hero blue');
    });

    expect(toast).toHaveBeenCalledWith({
      title: 'No merchant selected',
      description: 'Select a merchant before using the AI builder.',
      variant: 'destructive',
    });
    expect(mockFetchWithCsrf).not.toHaveBeenCalled();
  });

  it('passes the selected merchant to the AI draft apply request', async () => {
    const merchantId = '11111111-1111-4111-8111-111111111111';
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    const { result } = renderHook(() =>
      useBuilderAiDraftActions(
        createParams({
          merchantId,
        })
      )
    );

    await act(async () => {
      await result.current.applyAiDraft();
    });
    await waitFor(() =>
      expect(mockApplyAiDraftRequest).toHaveBeenCalledWith(
        expect.objectContaining({ merchantId })
      )
    );
  });

  it('keeps an in-flight merchant A apply from opening a stale dialog for merchant B', async () => {
    let resolveResponse!: (response: Response) => void;
    mockFetchWithCsrf.mockReturnValue(
      new Promise((resolve) => {
        resolveResponse = resolve;
      })
    );
    let merchantId = 'merchant-a';
    const setShowStaleAiDraftDialog = vi.fn();
    const setApplyingAiDraft = vi.fn();
    const setLastUpdated = vi.fn();
    const setPreviewMode = vi.fn();
    const { result, rerender } = renderHook(() =>
      useBuilderAiDraftActions(
        createParams({
          merchantId,
          setApplyingAiDraft,
          setLastUpdated,
          setPreviewMode,
          setShowStaleAiDraftDialog,
        })
      )
    );

    let apply!: Promise<void>;
    act(() => {
      apply = result.current.applyAiDraft();
    });
    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1));

    merchantId = 'merchant-b';
    rerender();
    resolveResponse({
      ok: false,
      status: 409,
      json: async () => ({ code: 'ai_draft_stale' }),
    } as Response);

    await apply;
    expect(setShowStaleAiDraftDialog).not.toHaveBeenCalledWith(true);
    expect(setLastUpdated).not.toHaveBeenCalled();
    expect(setPreviewMode).not.toHaveBeenCalled();
    expect(setApplyingAiDraft).toHaveBeenLastCalledWith(false);
  });

  it('keeps merchant A current when a speculative merchant B render is abandoned', async () => {
    let resolveResponse!: (response: Response) => void;
    mockFetchWithCsrf.mockReturnValue(
      new Promise((resolve) => {
        resolveResponse = resolve;
      })
    );
    const params = createParams();
    let committedApply: (() => Promise<void>) | undefined;
    const never = new Promise<void>(() => undefined);

    function Harness({ merchantId }: { merchantId: string }) {
      const actions = useBuilderAiDraftActions({ ...params, merchantId });
      useLayoutEffect(() => {
        committedApply = actions.applyAiDraft;
      });
      return null;
    }

    function SuspendAbandonedRender({ suspend }: { suspend: boolean }) {
      if (suspend) throw never;
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(Harness, { merchantId: 'merchant-a' }),
          createElement(SuspendAbandonedRender, { suspend: false })
        )
      );
    });

    let apply: Promise<void> | undefined;
    act(() => {
      apply = committedApply?.();
    });
    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalledOnce());

    act(() => {
      startTransition(() => {
        root.render(
          createElement(
            Suspense,
            { fallback: null },
            createElement(Harness, { merchantId: 'merchant-b' }),
            createElement(SuspendAbandonedRender, { suspend: true })
          )
        );
      });
    });

    await act(async () => {
      resolveResponse({
        ok: true,
        status: 200,
        json: async () => ({ lastUpdated: '2026-07-31T10:00:00.000Z' }),
      } as Response);
      await apply;
    });

    expect(params.setLastUpdated).toHaveBeenCalledWith(
      '2026-07-31T10:00:00.000Z'
    );
    expect(params.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'AI design applied' })
    );

    await act(async () => root.unmount());
  });
});
