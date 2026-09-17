import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuizAuthoringForm } from './quiz-authoring-form';

const prize = {
  available: true,
  condition: 'new',
  defaultVariantId: null,
  effectiveStock: 1,
  hasVariants: false,
  id: '55555555-5555-4555-8555-555555555555',
  imageUrl: null,
  manageStock: true,
  name: 'iPhone XR',
  price: 1,
  requiresVariantSelection: false,
  selectionId: 'prize:product',
  variantId: null,
  variantLabel: null,
};

describe('QuizAuthoringForm', () => {
  it('labels per-question time and emits a complete draft configuration', async () => {
    const onGenerate = vi.fn();
    const user = userEvent.setup();
    render(
      <QuizAuthoringForm
        disabled={false}
        initialProducts={[prize]}
        isGenerating={false}
        onGenerate={onGenerate}
      />
    );
    expect(
      screen.getByLabelText(/time per question \(seconds\)/i)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /generate draft/i }));
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'test',
        prizeProduct: prize,
        timePerQuestionSeconds: 10,
      })
    );
  });

  it('defaults to scheduled timing with the end synced to the expected play', () => {
    render(
      <QuizAuthoringForm
        disabled={false}
        initialProducts={[prize]}
        isGenerating={false}
        onGenerate={vi.fn()}
      />
    );
    // 2 default topics x 1 per topic x 10s = 20s, floored to 60s.
    const startInput = screen.getByLabelText(
      /scheduled start/i
    ) as HTMLInputElement;
    const endInput = screen.getByLabelText(
      /universal end/i
    ) as HTMLInputElement;
    const expectedEnd = new Date(new Date(startInput.value).getTime() + 60_000);
    const offset = expectedEnd.getTimezoneOffset() * 60_000;
    expect(endInput.value).toBe(
      new Date(expectedEnd.getTime() - offset).toISOString().slice(0, 16)
    );
  });

  it('keeps a manually edited end when the start changes', () => {
    render(
      <QuizAuthoringForm
        disabled={false}
        initialProducts={[prize]}
        isGenerating={false}
        onGenerate={vi.fn()}
      />
    );
    const startInput = screen.getByLabelText(
      /scheduled start/i
    ) as HTMLInputElement;
    const endInput = screen.getByLabelText(
      /universal end/i
    ) as HTMLInputElement;
    fireEvent.change(endInput, { target: { value: '2026-09-20T18:00' } });
    expect(endInput.value).toBe('2026-09-20T18:00');
    fireEvent.change(startInput, { target: { value: '2026-09-20T17:00' } });
    expect(endInput.value).toBe('2026-09-20T18:00');
  });
});
