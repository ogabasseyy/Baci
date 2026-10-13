import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SearchLayout from './layout';

describe('search layout', () => {
  it('eagerly styles search instead of waiting for first input', () => {
    render(
      <SearchLayout>
        <main>Search</main>
      </SearchLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Search');
  });
});
