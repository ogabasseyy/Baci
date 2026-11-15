// @vitest-environment jsdom

import type { Data } from '@puckeditor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme } from '@/lib/theme-manager';
import { loadBuilderData } from './load-builder-data';

type LoadBuilderDataParams = Parameters<typeof loadBuilderData>[0];

vi.mock('@/lib/theme-manager', () => ({
  applyTheme: vi.fn(),
}));

function createToastMock<T extends { toast: unknown }>() {
  return Object.assign(vi.fn(), { promise: vi.fn() }) as unknown as T['toast'];
}

const mockApplyTheme = vi.mocked(applyTheme);

function jsonResponse(
  body: unknown,
  options: { ok?: boolean; status?: number } = {}
) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function createParams() {
  return {
    merchantId: 'merchant-1',
    router: { push: vi.fn() } as unknown as LoadBuilderDataParams['router'],
    toast: createToastMock<LoadBuilderDataParams>(),
    setData: vi.fn(),
    setSeoData: vi.fn(),
    setStoreSettings: vi.fn(),
    setSetupSettings: vi.fn(),
    setPageLoading: vi.fn(),
    setLastUpdated: vi.fn(),
    setCanEdit: vi.fn(),
    setDegradedReason: vi.fn(),
    setPreviewMode: vi.fn(),
    setAiDraftJobId: vi.fn(),
    setCanApplyAiDraft: vi.fn(),
  };
}

function builderResponse(overrides: Record<string, unknown> = {}) {
  return {
    aiDraftJobId: null,
    canApplyAiDraft: false,
    canEdit: true,
    config: {
      content: [],
      root: { title: 'Loaded page' },
      zones: {},
      theme: { primary: '#000000' },
    } as Data & { theme: unknown },
    degraded: false,
    degradedReason: null,
    isDefault: false,
    lastUpdated: 'updated-at',
    previewMode: null,
    seo: {
      title: 'SEO title',
      description: 'SEO description',
      keywords: '',
      twitterCard: 'summary_large_image',
    },
    setupSettings: { site: { title: 'Site' } },
    storeSettings: { productPage: { layout: 'standard' } },
    ...overrides,
  };
}

describe('loadBuilderData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads builder data and applies loaded theme/settings', async () => {
    const body = builderResponse();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    const params = createParams();

    await loadBuilderData(params);

    expect(params.setData).toHaveBeenCalledWith(body.config);
    expect(params.setLastUpdated).toHaveBeenCalledWith('updated-at');
    expect(params.setCanEdit).toHaveBeenCalledWith(true);
    expect(params.setSeoData).toHaveBeenCalledWith(body.seo);
    expect(params.setStoreSettings).toHaveBeenCalledWith(body.storeSettings);
    expect(params.setSetupSettings).toHaveBeenCalledWith(body.setupSettings);
    expect(mockApplyTheme).toHaveBeenCalledWith(body.config.theme);
    expect(params.setPageLoading).toHaveBeenCalledWith(false);
  });

  it('adds aiDraftJobId from the current URL when present', async () => {
    const originalHref = window.location.href;
    try {
      window.history.pushState(null, '', '/builder?aiDraftJobId=job-123');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(builderResponse()))
      );
      const params = createParams();

      await loadBuilderData(params);

      const [requestedUrl, requestInit] = vi.mocked(fetch).mock.calls[0];
      const url = new URL(String(requestedUrl));
      expect(url.pathname).toBe('/api/builder');
      expect(url.searchParams.get('slug')).toBe('home');
      expect(url.searchParams.get('merchantId')).toBe('merchant-1');
      expect(url.searchParams.get('aiDraftJobId')).toBe('job-123');
      expect(requestInit).toEqual(
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    } finally {
      window.history.replaceState(null, '', originalHref);
    }
  });

  it('shows degraded and AI preview toasts', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            builderResponse({
              degraded: true,
              degradedReason: 'config_load_failed',
            })
          )
        )
        .mockResolvedValueOnce(
          jsonResponse(builderResponse({ previewMode: 'ai_draft' }))
        )
    );
    const degradedParams = createParams();
    const previewParams = createParams();

    await loadBuilderData(degradedParams);
    await loadBuilderData(previewParams);

    expect(degradedParams.toast).toHaveBeenCalledWith({
      title: 'Builder opened in read-only mode',
      description:
        'We could not load the latest builder draft from the server. Refresh to resume editing once the connection stabilizes.',
      variant: 'destructive',
    });
    expect(previewParams.toast).toHaveBeenCalledWith({
      title: 'AI draft preview',
      description:
        'Review the generated storefront before applying it to your draft.',
    });
  });

  it('redirects to login on 401 responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 401 }))
    );
    const params = createParams();

    await loadBuilderData(params);

    expect(params.router.push).toHaveBeenCalledWith('/login');
    expect(params.setPageLoading).toHaveBeenCalledWith(false);
  });

  it('falls back to default read-only data when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network down'))
    );
    const params = createParams();

    await loadBuilderData(params);

    expect(params.toast).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Failed to load page configuration. Using default template.',
      variant: 'destructive',
    });
    expect(params.setData).toHaveBeenCalledWith(
      expect.objectContaining({ root: { title: 'Home' } })
    );
    expect(params.setCanEdit).toHaveBeenCalledWith(false);
    expect(params.setDegradedReason).toHaveBeenCalledWith('config_load_failed');
    expect(params.setPageLoading).toHaveBeenCalledWith(false);
  });

  it('uses default data when the response has no config', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
    const params = createParams();

    await loadBuilderData(params);

    expect(params.setData).toHaveBeenCalledWith(
      expect.objectContaining({ root: { title: 'Home' } })
    );
    expect(mockApplyTheme).toHaveBeenCalled();
  });

  it('does not update state or toast after the caller aborts the bootstrap request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;

        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        });
      })
    );
    const controller = new AbortController();
    const params = { ...createParams(), signal: controller.signal };

    const pendingLoad = loadBuilderData(params);
    controller.abort();
    await pendingLoad;

    expect(params.toast).not.toHaveBeenCalled();
    expect(params.setData).not.toHaveBeenCalled();
    expect(params.setCanEdit).not.toHaveBeenCalled();
    expect(params.setPageLoading).not.toHaveBeenCalled();
  });
});
