import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { CustomizePreviewSwitch } from './CustomizePreviewSwitch';

const mocks = vi.hoisted(() => ({
  currentUser: 'user-1' as string | null,
  sessionUser: 'user-1' as string | null,
  merchantId: 'merchant-1' as string | null,
  check: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    session: { user: { id: 'user-1' } },
  }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    merchant: { id: 'merchant-1', slug: 'acme' },
    resolvedForUserId: 'user-1',
    storeUrl: 'store.example',
  }),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      user: mocks.currentUser ? { id: mocks.currentUser } : null,
      session: mocks.sessionUser ? { user: { id: mocks.sessionUser } } : null,
    }),
  },
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: () => ({
      resolvedForUserId: 'user-1',
      merchant: mocks.merchantId ? { id: mocks.merchantId } : null,
    }),
  }),
}));
vi.mock('@/lib/api-base-url', () => ({ BASE_URL: 'https://usebaci.com' }));
vi.mock('./CustomizePreviewPane', () => ({
  CustomizePreviewPane: () => <div>URL preview</div>,
}));
vi.mock('./NativeCustomizePreviewPane', () => ({
  NativeCustomizePreviewPane: ({
    isIdentityCurrent,
    previewUrl,
    onFallback,
  }: {
    onFallback: () => void;
    isIdentityCurrent: () => boolean;
    previewUrl: string;
  }) => (
    <>
      <button type="button" onClick={() => mocks.check(isIdentityCurrent())}>
        {previewUrl}
      </button>
      <button type="button" onClick={onFallback}>
        published
      </button>
    </>
  ),
}));
const props = {
  colors: LIGHT_COLORS,
  previewKey: 1,
  config: { content: [], root: { props: { title: 'Home' } } },
};

describe('customize preview selection', () => {
  beforeEach(() => {
    mocks.currentUser = 'user-1';
    mocks.sessionUser = 'user-1';
    mocks.merchantId = 'merchant-1';
    mocks.check.mockReset();
  });
  it('uses the isolated native preview only while account and merchant remain current', () => {
    render(<CustomizePreviewSwitch {...props} />);
    const button = screen.getByRole('button', {
      name: 'https://usebaci.com/template-preview/builder-preview?native=2',
    });
    fireEvent.click(button);
    expect(mocks.check).toHaveBeenLastCalledWith(true);
    mocks.currentUser = 'user-2';
    fireEvent.click(button);
    expect(mocks.check).toHaveBeenLastCalledWith(false);
    mocks.currentUser = 'user-1';
    mocks.sessionUser = null;
    fireEvent.click(button);
    expect(mocks.check).toHaveBeenLastCalledWith(false);
    mocks.sessionUser = 'user-1';
    mocks.merchantId = 'merchant-2';
    fireEvent.click(button);
    expect(mocks.check).toHaveBeenLastCalledWith(false);
  });
  it('returns to the published preview when the native draft is unavailable', () => {
    render(<CustomizePreviewSwitch {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'published' }));
    expect(screen.getByText('URL preview')).toBeInTheDocument();
  });
  it('preserves the URL-only preview when no draft is present', () => {
    render(<CustomizePreviewSwitch {...props} config={null} />);
    expect(screen.getByText('URL preview')).toBeInTheDocument();
  });
});
