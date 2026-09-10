import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCoreCssImport,
  mockHomeCssImport,
  mockLoadStylesheetAfterWindowLoad,
} = vi.hoisted(() => {
  const createImportMock = () => {
    const state = {
      load: vi.fn(),
    };

    return {
      factory: () => {
        state.load();
        return {};
      },
      state,
    };
  };

  return {
    mockCoreCssImport: createImportMock(),
    mockHomeCssImport: createImportMock(),
    mockLoadStylesheetAfterWindowLoad: vi.fn(
      (load: () => Promise<unknown>, _errorMessage: string) => {
        void load();
        return () => undefined;
      }
    ),
  };
});

vi.mock('@/app/(storefront)/storefront-core.css', mockCoreCssImport.factory);
vi.mock('@/app/(storefront)/storefront-home.css', mockHomeCssImport.factory);
vi.mock('@/app/(storefront)/load-stylesheet-after-window-load', () => ({
  loadStylesheetAfterWindowLoad: (
    load: () => Promise<unknown>,
    errorMessage: string
  ) => mockLoadStylesheetAfterWindowLoad(load, errorMessage),
}));

import { OgabasseyHomeStyleLoader } from './ogabassey-home-style-loader';

function stubMatchMedia(matches: boolean) {
  const media = {
    matches,
    media: '(min-width: 768px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => media),
  });
}

describe('OgabasseyHomeStyleLoader', () => {
  beforeEach(() => {
    mockCoreCssImport.state.load.mockClear();
    mockHomeCssImport.state.load.mockClear();
    mockLoadStylesheetAfterWindowLoad.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not load homepage CSS on a mobile viewport until the first input', async () => {
    stubMatchMedia(false);
    render(<OgabasseyHomeStyleLoader />);

    expect(mockCoreCssImport.state.load).not.toHaveBeenCalled();
    expect(mockHomeCssImport.state.load).not.toHaveBeenCalled();
    expect(mockLoadStylesheetAfterWindowLoad).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));

    await waitFor(() => {
      expect(mockCoreCssImport.state.load).toHaveBeenCalledOnce();
      expect(mockHomeCssImport.state.load).toHaveBeenCalledOnce();
    });
  });

  it('starts homepage CSS on desktop during render', () => {
    stubMatchMedia(true);
    render(<OgabasseyHomeStyleLoader />);

    expect(mockLoadStylesheetAfterWindowLoad).toHaveBeenCalledOnce();
  });
});
