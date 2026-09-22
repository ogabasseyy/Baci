import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfiguredAgenticMerchantSlug: vi.fn(),
  getMerchantForUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/agentic/agentic-merchant-slug', () => ({
  getConfiguredAgenticMerchantSlug: mocks.getConfiguredAgenticMerchantSlug,
}));
vi.mock('@/lib/merchant-server', () => ({
  getMerchantForUser: mocks.getMerchantForUser,
}));
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
}));
vi.mock('./client-page', () => ({
  default: () => <div>Santa analytics</div>,
}));

import SantaPage from './page';

describe('SantaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfiguredAgenticMerchantSlug.mockReturnValue('winter-store');
    mocks.getMerchantForUser.mockResolvedValue({
      merchant: { slug: 'winter-store' },
    });
  });

  it('renders analytics for the configured Santa merchant', async () => {
    const page = await SantaPage();

    render(page);

    expect(screen.getByText('Santa analytics')).toBeInTheDocument();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('returns not found for a different merchant', async () => {
    mocks.getMerchantForUser.mockResolvedValue({
      merchant: { slug: 'other-store' },
    });

    await expect(SantaPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
