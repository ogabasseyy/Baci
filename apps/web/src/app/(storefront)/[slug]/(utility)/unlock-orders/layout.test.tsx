import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import UnlockOrdersLayout from './layout';

describe('unlock-orders layout', () => {
  it('eagerly styles unlock orders instead of waiting for first input', () => {
    render(
      <UnlockOrdersLayout>
        <main>Unlock orders</main>
      </UnlockOrdersLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Unlock orders');
  });
});
