import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JumiaOrderActionControls } from './jumia-order-action-controls';

describe('JumiaOrderActionControls', () => {
  it('dispatches the selected action and displays generated labels', () => {
    const handleAction = vi.fn();

    render(
      <JumiaOrderActionControls
        actionLoading={null}
        blockedLabelUrl="https://cdn.example/blocked.pdf"
        handleAction={handleAction}
        labelUrls={['https://cdn.example/label.pdf']}
        orderNumber="1001"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /print label/i }));
    expect(handleAction).toHaveBeenCalledWith('print_label');
    expect(screen.getByText('Shipping Labels:')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://cdn.example/label.pdf' })
    ).toHaveAttribute('href', 'https://cdn.example/label.pdf');
    expect(
      screen.getByText(/browser blocked the label popup/i)
    ).toBeInTheDocument();
  });

  it('disables all actions while an action is running', () => {
    render(
      <JumiaOrderActionControls
        actionLoading="pack"
        blockedLabelUrl={null}
        handleAction={vi.fn()}
        labelUrls={[]}
        orderNumber="1001"
      />
    );

    expect(screen.getByRole('button', { name: /pack all/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /ready to ship/i })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /print label/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('omits mutation actions for viewers without manage permission', () => {
    render(
      <JumiaOrderActionControls
        actionLoading={null}
        blockedLabelUrl={null}
        canManage={false}
        handleAction={vi.fn()}
        labelUrls={[]}
        orderNumber="1001"
      />
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/view only/i)).toBeInTheDocument();
  });
});
