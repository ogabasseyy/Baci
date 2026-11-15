import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requestDeviceGrading: vi.fn() }));

vi.mock('@/lib/storefront/request-device-grading', () => ({
  requestDeviceGrading: mocks.requestDeviceGrading,
}));

import { TradeInModal } from './swap-trade-in-modal';

const graded = {
  model: 'iPhone 14',
  grade: 'Good' as const,
  observations: ['Light scratches'],
  basePrice: 400000,
  estimatedValue: 240000,
  deductionPercent: 40,
  matchedProduct: 'iPhone 14 128GB',
};

function renderModal(onClose = vi.fn()) {
  render(
    <TradeInModal
      isOpen
      onClose={onClose}
      supportPhone="2348000000000"
      merchantSlug="ogabassey"
    />
  );
  return onClose;
}

function chooseVideo(video: File) {
  fireEvent.change(screen.getByLabelText(/upload a video/i), {
    target: { files: [video] },
  });
}

async function analyse() {
  chooseVideo(new File(['video'], 'device.mp4', { type: 'video/mp4' }));
  fireEvent.click(screen.getByRole('button', { name: /analyze device/i }));
}

describe('TradeInModal', () => {
  beforeEach(() => {
    mocks.requestDeviceGrading.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders nothing while closed', () => {
    const { container } = render(
      <TradeInModal isOpen={false} onClose={vi.fn()} supportPhone="234" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps Analyze disabled until a video is chosen', () => {
    renderModal();

    expect(
      screen.getByRole('button', { name: /analyze device/i })
    ).toBeDisabled();
  });

  it('refuses a video above 50MB without calling the server', () => {
    renderModal();
    const huge = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 + 1 });

    chooseVideo(huge);

    expect(screen.getByText(/video is too large/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /analyze device/i })
    ).toBeDisabled();
  });

  it('grades for the given store and hands the accepted offer to support chat', async () => {
    mocks.requestDeviceGrading.mockResolvedValue(graded);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onClose = renderModal();

    await analyse();

    expect(await screen.findByText('₦240,000')).toBeInTheDocument();
    expect(mocks.requestDeviceGrading).toHaveBeenCalledWith(
      expect.any(File),
      'ogabassey'
    );

    fireEvent.click(
      screen.getByRole('button', { name: /accept offer & chat/i })
    );

    const url = decodeURIComponent(String(open.mock.calls[0]?.[0]));
    expect(url).toContain('https://wa.me/2348000000000?text=');
    expect(url).toContain('Estimate: ₦240,000');
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves the estimate out of the chat message when no price matched', async () => {
    mocks.requestDeviceGrading.mockResolvedValue({
      ...graded,
      basePrice: 0,
      estimatedValue: 0,
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderModal();

    await analyse();
    fireEvent.click(
      await screen.findByRole('button', { name: /get my value in chat/i })
    );

    expect(screen.queryByText('₦0')).not.toBeInTheDocument();
    expect(decodeURIComponent(String(open.mock.calls[0]?.[0]))).not.toContain(
      'Estimate'
    );
  });

  it('returns to upload with the error and a support link when grading fails', async () => {
    mocks.requestDeviceGrading.mockRejectedValue(
      new Error('We could not check this device right now. Please try again.')
    );
    renderModal();

    await analyse();

    expect(
      await screen.findByText(/could not check this device/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /chat with support instead/i })
    ).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/2348000000000')
    );
  });
});
