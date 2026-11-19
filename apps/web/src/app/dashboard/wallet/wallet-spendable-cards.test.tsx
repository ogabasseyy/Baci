import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WalletSpendableCards } from './wallet-spendable-cards';

const fmt = (n: number) => `₦${n}`;

describe('WalletSpendableCards', () => {
  it('shows both figures and the under-review note when non-zero', () => {
    render(
      <WalletSpendableCards
        formatMoney={fmt}
        spendable={{
          spendableBalance: 1,
          settledToBankTotal: 2,
          pendingReconciliationTotal: 3,
        }}
      />
    );
    expect(screen.getByText('₦1')).toBeInTheDocument();
    expect(screen.getByText('₦2')).toBeInTheDocument();
    expect(screen.getByText(/being reviewed/i)).toHaveTextContent('₦3');
  });
  it('omits the under-review note when nothing is pending', () => {
    render(
      <WalletSpendableCards
        formatMoney={fmt}
        spendable={{
          spendableBalance: 1,
          settledToBankTotal: 2,
          pendingReconciliationTotal: 0,
        }}
      />
    );
    expect(screen.queryByText(/being reviewed/i)).not.toBeInTheDocument();
  });
});
