import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Loading from './loading';

describe('SearchLoading', () => {
  it('announces the pending results without claiming counts', () => {
    const { container } = render(<Loading />);

    expect(
      screen.getByRole('status', { name: 'Loading search results' })
    ).toBeInTheDocument();
    expect(container.querySelectorAll('.grid > .animate-pulse')).toHaveLength(
      8
    );
  });
});
