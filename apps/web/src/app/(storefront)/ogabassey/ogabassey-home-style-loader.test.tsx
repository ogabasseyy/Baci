import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadOgabasseyHomeStyles, mockLoadStylesheetAfterFirstInput } =
  vi.hoisted(() => ({
    mockLoadOgabasseyHomeStyles: vi.fn(() => Promise.resolve({})),
    mockLoadStylesheetAfterFirstInput: vi.fn(
      (_load: () => Promise<unknown>, _errorMessage: string) => {
        return () => undefined;
      }
    ),
  }));

vi.mock('./load-ogabassey-home-styles', () => ({
  loadOgabasseyHomeStyles: () => mockLoadOgabasseyHomeStyles(),
}));
vi.mock('@/app/(storefront)/load-stylesheet-after-first-input', () => ({
  loadStylesheetAfterFirstInput: (
    load: () => Promise<unknown>,
    errorMessage: string
  ) => mockLoadStylesheetAfterFirstInput(load, errorMessage),
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
    mockLoadOgabasseyHomeStyles.mockReset();
    mockLoadOgabasseyHomeStyles.mockResolvedValue({});
    mockLoadStylesheetAfterFirstInput.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not load homepage CSS on a mobile viewport until the first input', () => {
    stubMatchMedia(false);
    render(<OgabasseyHomeStyleLoader />);

    expect(mockLoadOgabasseyHomeStyles).not.toHaveBeenCalled();
    expect(mockLoadStylesheetAfterFirstInput).toHaveBeenCalledOnce();
  });

  it('starts homepage CSS on desktop during effect instead of waiting for window load', async () => {
    stubMatchMedia(true);
    render(<OgabasseyHomeStyleLoader />);

    await waitFor(() => {
      expect(mockLoadOgabasseyHomeStyles).toHaveBeenCalledOnce();
    });
    expect(mockLoadStylesheetAfterFirstInput).not.toHaveBeenCalled();
  });

  it('re-arms desktop homepage CSS after a failed immediate import', async () => {
    stubMatchMedia(true);
    mockLoadOgabasseyHomeStyles
      .mockRejectedValueOnce(new Error('chunk missing'))
      .mockResolvedValueOnce({});
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    render(<OgabasseyHomeStyleLoader />);

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledOnce();
    });
    expect(mockLoadOgabasseyHomeStyles).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event('pointerdown'));
    await waitFor(() => {
      expect(mockLoadOgabasseyHomeStyles).toHaveBeenCalledTimes(2);
    });
    expect(mockLoadStylesheetAfterFirstInput).not.toHaveBeenCalled();
  });
});
