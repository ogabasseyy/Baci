import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuizAuthoringForm } from './quiz-authoring-form';

const prize = {
  available: true,
  condition: 'new',
  defaultVariantId: null,
  effectiveStock: 1,
  hasVariants: false,
  id: 'prize',
  imageUrl: null,
  manageStock: true,
  name: 'Phone',
  price: 1,
  requiresVariantSelection: false,
  selectionId: 'prize:product',
  variantId: null,
  variantLabel: null,
};

function setup() {
  const onGenerate = vi.fn();
  render(
    <QuizAuthoringForm
      disabled={false}
      initialProducts={[prize]}
      isGenerating={false}
      onGenerate={onGenerate}
    />
  );
  fireEvent.change(screen.getByLabelText(/launch timing/i), {
    target: { value: 'immediate' },
  });
  return onGenerate;
}

describe('immediate quiz duration', () => {
  it('defaults to the exact play duration and supports sub-minute tests', () => {
    const onGenerate = setup();
    expect(
      screen.getByLabelText(/total quiz duration \(seconds\)/i)
    ).toHaveValue(20);
    fireEvent.change(
      screen.getByLabelText(/total quiz duration \(seconds\)/i),
      { target: { value: '25' } }
    );
    fireEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ liveWindowMinutes: 25 / 60 })
    );
    expect(screen.getByText(/After 25s/)).toBeInTheDocument();
  });

  it('retains live grace validation instead of accepting a too-short live quiz', () => {
    setup();
    fireEvent.change(screen.getByLabelText(/^mode$/i), {
      target: { value: 'live' },
    });
    expect(
      screen.getByLabelText(/total quiz duration \(seconds\)/i)
    ).toHaveValue(120);
    fireEvent.change(
      screen.getByLabelText(/total quiz duration \(seconds\)/i),
      { target: { value: '25' } }
    );
    expect(
      screen.getByRole('button', { name: /generate draft/i })
    ).toBeDisabled();
  });

  it('updates an untouched duration as questions change, but preserves a manual duration', () => {
    setup();
    fireEvent.change(screen.getByLabelText(/questions per topic/i), {
      target: { value: '3' },
    });
    expect(
      screen.getByLabelText(/total quiz duration \(seconds\)/i)
    ).toHaveValue(60);
    fireEvent.change(
      screen.getByLabelText(/total quiz duration \(seconds\)/i),
      { target: { value: '90' } }
    );
    fireEvent.change(screen.getByLabelText(/questions per topic/i), {
      target: { value: '2' },
    });
    expect(
      screen.getByLabelText(/total quiz duration \(seconds\)/i)
    ).toHaveValue(90);
  });
});
