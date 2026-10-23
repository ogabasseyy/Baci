import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';
import { useGamingSelectionPreview } from './use-gaming-selection-preview';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

describe('useGamingSelectionPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('restores an uncertain creation guard and blocks an unacknowledged create', async () => {
    gamingSelectionPreviewCache.markUncertainCreation('merchant-1');
    const { result } = renderHook(() =>
      useGamingSelectionPreview('merchant-1')
    );

    await waitFor(() => {
      expect(result.current.creationOutcomeUnknown).toBe(true);
    });
    await act(() => result.current.createPreview('create'));

    expect(result.current.error).toMatch(/may have created this preview/i);
    expect(fetchWithCsrf).not.toHaveBeenCalled();
  });
});
