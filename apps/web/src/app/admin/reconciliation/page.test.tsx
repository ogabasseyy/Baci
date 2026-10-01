import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReconciliationPage from './page';

vi.mock('./reconciliation-client', () => ({
  ReconciliationClient: () => <div>Reconciliation client</div>,
}));

describe('ReconciliationPage', () => {
  it('delegates the route to the interactive reconciliation client', () => {
    render(<ReconciliationPage />);

    expect(screen.getByText('Reconciliation client')).toBeVisible();
  });
});
