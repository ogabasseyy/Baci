import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Merchant360Loading from '@/app/admin/merchants/[merchantId]/loading';

describe('Merchant360Loading', () => {
  it('renders a route loading state with summary and operations placeholders', () => {
    render(<Merchant360Loading />);

    expect(
      screen.getByRole('status', { name: 'Loading merchant operations' })
    ).toBeInTheDocument();
  });
});
