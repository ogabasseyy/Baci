import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CategoryLayout from './layout';

describe('category layout', () => {
  it('eagerly styles category pages instead of waiting for first input', () => {
    render(
      <CategoryLayout>
        <main>Category</main>
      </CategoryLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Category');
  });
});
