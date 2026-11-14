import { fireEvent, render, screen } from '@testing-library/react';
import { CreditCard } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentScheduleCard } from './PaymentScheduleCard';

function renderCard(selected: boolean, onSelect: () => void = vi.fn()) {
  return render(
    <PaymentScheduleCard
      title="Pay Small Small"
      subtitle="Split into three payments"
      icon={CreditCard}
      selected={selected}
      onSelect={onSelect}
    >
      <p>Installment terms</p>
    </PaymentScheduleCard>
  );
}

describe('payment schedule card', () => {
  it('collapses its content while unselected', () => {
    renderCard(false);

    const trigger = screen.getByRole('button', { name: 'Pay Small Small' });

    expect(trigger).toHaveAttribute('aria-pressed', 'false');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Split into three payments')).toBeVisible();
    expect(screen.queryByText('Installment terms')).toBeNull();
    expect(trigger.closest('section')).not.toHaveClass('border-store-primary');
  });

  it('expands its content and marks the card when selected', () => {
    renderCard(true);

    const trigger = screen.getByRole('button', { name: 'Pay Small Small' });

    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Installment terms')).toBeVisible();
    expect(trigger.closest('section')).toHaveClass('border-store-primary');
  });

  it('notifies the parent when the card is activated', () => {
    const onSelect = vi.fn();
    renderCard(false, onSelect);

    fireEvent.click(screen.getByRole('button', { name: 'Pay Small Small' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('collapses again when the selection moves elsewhere', () => {
    const onSelect = vi.fn();
    const { rerender } = renderCard(true, onSelect);
    expect(screen.getByText('Installment terms')).toBeVisible();

    rerender(
      <PaymentScheduleCard
        title="Pay Small Small"
        subtitle="Split into three payments"
        icon={CreditCard}
        selected={false}
        onSelect={onSelect}
      >
        <p>Installment terms</p>
      </PaymentScheduleCard>
    );

    expect(screen.queryByText('Installment terms')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Pay Small Small' })
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
