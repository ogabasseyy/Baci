import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchPageStartPanel } from './search-page-start-panel';

describe('SearchPageStartPanel', () => {
  it('invites an initial search term', () => {
    render(<SearchPageStartPanel />);

    expect(
      screen.getByRole('heading', { name: /start a search/i })
    ).toBeInTheDocument();
  });
});
