import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SwapLayout from './layout';

describe('swap layout', () => {
  it('eagerly styles swap instead of waiting for first input', () => {
    render(
      <SwapLayout>
        <main>Swap</main>
      </SwapLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Swap');
  });
});
