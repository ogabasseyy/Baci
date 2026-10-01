import { render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Merchant360MetricCard } from './merchant-360-metric-card';

describe('Merchant360MetricCard', () => {
  it('labels its metric for assistive technology', () => {
    render(
      <Merchant360MetricCard icon={Users} label="Customers" value={101} />
    );

    expect(
      screen.getByRole('group', { name: 'Customers summary' })
    ).toHaveTextContent('101');
  });
});
