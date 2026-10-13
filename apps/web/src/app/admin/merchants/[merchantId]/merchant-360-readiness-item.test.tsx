import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Merchant360ReadinessItem } from './merchant-360-readiness-item';

describe('Merchant360ReadinessItem', () => {
  it('clearly identifies an incomplete requirement', () => {
    render(<Merchant360ReadinessItem label="Payments" ready={false} />);

    expect(screen.getByText('Payments')).toBeVisible();
    expect(screen.getByText('Needs attention')).toBeVisible();
  });
});
