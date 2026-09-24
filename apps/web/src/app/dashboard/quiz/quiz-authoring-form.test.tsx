import { render, screen } from '@testing-library/react';
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
        totalQuizDurationSeconds: 20,
        timePerQuestionSeconds: 10,
      })
    );
  });

  it('allows a merchant to extend the computed play time', async () => {
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

    expect(screen.getByText(/Total quiz duration: 20s/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /extend play time/i }));
    const totalDuration = screen.getByLabelText(
      /total quiz duration \(seconds\)/i
    );
    await user.clear(totalDuration);
    await user.type(totalDuration, '90');
    await user.click(screen.getByRole('button', { name: /generate draft/i }));

    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ totalQuizDurationSeconds: 90 })
    );
  });

  it('defaults live launches to the suggested contract window', async () => {
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

    await user.selectOptions(screen.getByLabelText('Mode'), 'live');

    expect(screen.getByText(/Total quiz duration: 2m/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /extend play time/i }));
    const totalDuration = screen.getByLabelText(
      /total quiz duration \(seconds\)/i
    );
    expect(totalDuration).toHaveAttribute('min', '50');
    expect(totalDuration).toHaveAttribute('max', '140');
    await user.click(screen.getByRole('button', { name: /generate draft/i }));

    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'live',
        totalQuizDurationSeconds: 120,
      })
    );
  });
});
