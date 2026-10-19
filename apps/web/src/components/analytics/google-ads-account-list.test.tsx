import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GoogleAdsAccountList } from './google-ads-account-list';

describe('GoogleAdsAccountList', () => {
  it('renders masked accounts and exposes save and cancel actions', () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();

    render(
      <GoogleAdsAccountList
        accounts={[{ customerId: '1234567890', selected: false }]}
        isSaving={false}
        onCancel={onCancel}
        onSave={onSave}
        onSelect={vi.fn()}
        selectedCustomerId="1234567890"
      />
    );

    expect(
      screen.getByRole('radio', { name: /••••7890/i })
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /save account and sync spend/i })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('notifies selection changes and disables save without a ready selection', () => {
    const onSelect = vi.fn();
    const view = render(
      <GoogleAdsAccountList
        accounts={[
          { customerId: '1234567890', selected: true },
          { customerId: '5555555555', selected: false },
        ]}
        isSaving={false}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onSelect={onSelect}
        selectedCustomerId="1234567890"
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: /••••5555/i }));
    expect(onSelect).toHaveBeenCalledWith('5555555555');

    view.rerender(
      <GoogleAdsAccountList
        accounts={[{ customerId: '1234567890', selected: true }]}
        isSaving={false}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onSelect={onSelect}
        selectedCustomerId={null}
      />
    );
    expect(
      screen.getByRole('button', { name: /save account and sync spend/i })
    ).toBeDisabled();

    view.rerender(
      <GoogleAdsAccountList
        accounts={[{ customerId: '1234567890', selected: true }]}
        isSaving
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onSelect={onSelect}
        selectedCustomerId="1234567890"
      />
    );
    expect(
      screen.getByRole('button', { name: /save account and sync spend/i })
    ).toBeDisabled();
  });
});
