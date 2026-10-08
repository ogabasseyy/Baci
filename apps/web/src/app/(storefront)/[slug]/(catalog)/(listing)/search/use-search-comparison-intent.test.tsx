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

describe('useSearchComparisonIntent', () => {
  it('stays idle outside a session', () => {
    render(<Probe />);
    expect(screen.getByRole('button', { name: 'idle' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'idle' }));
    expect(screen.getByRole('button', { name: 'idle' })).toBeInTheDocument();
  });

  it('activates within a session', () => {
    render(
      <SearchComparisonSession scope="iphone">
        <Probe />
      </SearchComparisonSession>
    );
    fireEvent.click(screen.getByRole('button', { name: 'idle' }));
    expect(screen.getByRole('button', { name: 'active' })).toBeInTheDocument();
  });
});
