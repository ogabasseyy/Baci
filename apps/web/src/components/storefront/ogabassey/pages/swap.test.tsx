import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithCsrf: vi.fn(),
  useMerchantSafe: vi.fn(),
  extractVideoFrames: vi.fn(),
}));

vi.mock('@/lib/storefront/extract-video-frames', () => ({
  extractVideoFrames: mocks.extractVideoFrames,
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mocks.fetchWithCsrf,
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: mocks.useMerchantSafe,
}));

import { OgabasseyV2Swap } from './swap';

describe('OgabasseyV2Swap', () => {
  beforeEach(() => {
    mocks.fetchWithCsrf.mockReset();
    // jsdom cannot decode video; the small test clip is then sent as-is.
    mocks.extractVideoFrames.mockReset();
    mocks.extractVideoFrames.mockRejectedValue(new Error('unsupported'));
    mocks.useMerchantSafe.mockReturnValue({ merchant: null });
  });

  it('sends the selected device video through the CSRF-aware grading request', async () => {
    mocks.fetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          model: 'iPhone 14',
          grade: 'Good',
          observations: [],
          basePrice: 400000,
          estimatedValue: 320000,
          deductionPercent: 20,
          matchedProduct: 'iPhone 14',
        },
      }),
    });

    render(<OgabasseyV2Swap />);

    fireEvent.click(screen.getByRole('button', { name: /start ai trade-in/i }));
    const video = new File(['video'], 'device.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText(/upload a video/i), {
      target: { files: [video] },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze device/i }));

    await waitFor(() => {
      expect(mocks.fetchWithCsrf).toHaveBeenCalledWith(
        '/api/ai/grade-device',
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
      );
    });

    const request = mocks.fetchWithCsrf.mock.calls[0]?.[1] as RequestInit;
    expect((request.body as FormData).get('video')).toBe(video);
  });

  it('shows the grading API error and returns to upload when analysis is rejected', async () => {
    mocks.fetchWithCsrf.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'The video is too blurry' }),
    });

    render(<OgabasseyV2Swap />);

    fireEvent.click(screen.getByRole('button', { name: /start ai trade-in/i }));
    const video = new File(['video'], 'device.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText(/upload a video/i), {
      target: { files: [video] },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze device/i }));

    expect(
      await screen.findByText('The video is too blurry')
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/upload a video/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /chat with support instead/i })
    ).toHaveAttribute('href', expect.stringContaining('https://wa.me/'));
  });

  it('sends the store slug and never shows a ₦0 offer when no price matched', async () => {
    mocks.useMerchantSafe.mockReturnValue({
      merchant: { slug: 'ogabassey', support_phone: '+234 800 000 0000' },
    });
    mocks.fetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          model: 'Nokia 3310',
          grade: 'Fair',
          observations: ['Worn keypad'],
          basePrice: 0,
          estimatedValue: 0,
          deductionPercent: 20,
          matchedProduct: 'Unknown Device',
        },
      }),
    });

    render(<OgabasseyV2Swap />);

    fireEvent.click(screen.getByRole('button', { name: /start ai trade-in/i }));
    fireEvent.change(screen.getByLabelText(/upload a video/i), {
      target: {
        files: [new File(['video'], 'device.mp4', { type: 'video/mp4' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze device/i }));

    expect(await screen.findByText('Confirmed in chat')).toBeInTheDocument();
    expect(screen.queryByText('₦0')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /get my value in chat/i })
    ).toBeInTheDocument();

    const request = mocks.fetchWithCsrf.mock.calls[0]?.[1] as RequestInit;
    expect((request.body as FormData).get('merchantSlug')).toBe('ogabassey');
  });

  it('does not name the AI provider to customers', () => {
    render(<OgabasseyV2Swap />);

    expect(screen.queryByText(/gemini/i)).not.toBeInTheDocument();
  });
});
