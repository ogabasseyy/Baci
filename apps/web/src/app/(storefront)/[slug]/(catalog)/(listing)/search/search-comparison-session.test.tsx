'use client';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchComparisonSession } from './search-comparison-session';
import { useSearchComparisonIntent } from './use-search-comparison-intent';

function Probe() {
  const intent = useSearchComparisonIntent();
  return (
    <button type="button" onClick={() => intent.activate()}>
      {intent.active ? 'active' : 'idle'}
    </button>
  );
}

describe('SearchComparisonSession', () => {
  it('starts idle and activates on demand', () => {
    render(
      <SearchComparisonSession scope="iphone">
        <Probe />
      </SearchComparisonSession>
    );
    expect(screen.getByRole('button', { name: 'idle' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'idle' }));
    expect(screen.getByRole('button', { name: 'active' })).toBeInTheDocument();
  });
  it('resets the intent when the search scope changes', () => {
    const view = render(
      <SearchComparisonSession scope="iphone">
        <Probe />
      </SearchComparisonSession>
    );
    fireEvent.click(screen.getByRole('button', { name: 'idle' }));
    expect(screen.getByRole('button', { name: 'active' })).toBeInTheDocument();
    view.rerender(
      <SearchComparisonSession scope="laptop">
        <Probe />
      </SearchComparisonSession>
    );
    expect(screen.getByRole('button', { name: 'idle' })).toBeInTheDocument();
  });
});
