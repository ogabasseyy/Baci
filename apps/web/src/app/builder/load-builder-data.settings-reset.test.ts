// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultBuilderSettings } from './builder-default-settings';
import { loadBuilderData } from './load-builder-data';

type LoadBuilderDataParams = Parameters<typeof loadBuilderData>[0];

vi.mock('@/lib/theme-manager', () => ({
  applyTheme: vi.fn(),
}));

function builderResponse(overrides: Record<string, unknown> = {}) {
  return {
    aiDraftJobId: null,
    canApplyAiDraft: false,
    canEdit: true,
    config: { content: [], root: { title: 'Merchant A' }, zones: {} },
    degraded: false,
    degradedReason: null,
    isDefault: false,
    lastUpdated: 'updated-at',
    previewMode: null,
    seo: null,
    setupSettings: { site: { title: 'Merchant A setup' } },
    storeSettings: { productPage: { layout: 'wide' } },
    ...overrides,
  };
}

function response(body: unknown) {
  return { ok: true, json: vi.fn().mockResolvedValue(body) };
}

function createParams() {
  const setStoreSettings = vi.fn();
  const setSetupSettings = vi.fn();
  const params: LoadBuilderDataParams = {
    merchantId: 'merchant-b',
    router: { push: vi.fn() } as unknown as LoadBuilderDataParams['router'],
    toast: Object.assign(vi.fn(), {
      promise: vi.fn(),
    }) as unknown as LoadBuilderDataParams['toast'],
    setAiDraftJobId: vi.fn(),
    setCanApplyAiDraft: vi.fn(),
    setCanEdit: vi.fn(),
    setData: vi.fn(),
    setDegradedReason: vi.fn(),
    setLastUpdated: vi.fn(),
    setPageLoading: vi.fn(),
    setPreviewMode: vi.fn(),
    setSeoData: vi.fn(),
    setSetupSettings,
    setStoreSettings,
  };

  return { params, setSetupSettings, setStoreSettings };
}

function expectDefaultSettings({
  setSetupSettings,
  setStoreSettings,
}: Pick<
  ReturnType<typeof createParams>,
  'setSetupSettings' | 'setStoreSettings'
>) {
  const defaults = createDefaultBuilderSettings();
  expect(setStoreSettings).toHaveBeenLastCalledWith(defaults.storeSettings);
  expect(setSetupSettings).toHaveBeenLastCalledWith(defaults.setupSettings);
}

describe('bugfix: builder merchant switches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('resets null settings from merchant B instead of retaining merchant A settings', async () => {
    const { params, setSetupSettings, setStoreSettings } = createParams();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(builderResponse()))
        .mockResolvedValueOnce({
          ...response(
            builderResponse({
              config: { content: [], root: { title: 'Merchant B' }, zones: {} },
              setupSettings: null,
              storeSettings: null,
            })
          ),
        })
    );

    await loadBuilderData({ ...params, merchantId: 'merchant-a' });
    await loadBuilderData(params);

    expectDefaultSettings({ setSetupSettings, setStoreSettings });
  });

  it('resets settings when merchant B has no builder config', async () => {
    const { params, setSetupSettings, setStoreSettings } = createParams();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(builderResponse()))
        .mockResolvedValueOnce(response({}))
    );

    await loadBuilderData({ ...params, merchantId: 'merchant-a' });
    await loadBuilderData(params);

    expectDefaultSettings({ setSetupSettings, setStoreSettings });
  });

  it('resets settings when merchant B builder loading fails', async () => {
    const { params, setSetupSettings, setStoreSettings } = createParams();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(builderResponse()))
        .mockRejectedValueOnce(new Error('Network down'))
    );

    await loadBuilderData({ ...params, merchantId: 'merchant-a' });
    await loadBuilderData(params);

    expectDefaultSettings({ setSetupSettings, setStoreSettings });
  });
});
