import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeBoundary } from './runtime-boundary';

describe('runtime boundary', () => {
  it('renders authored content', () => {
    render(
      <RuntimeBoundary>
        <button type="button">Custom interaction</button>
      </RuntimeBoundary>
    );
    expect(
      screen.getByRole('button', { name: 'Custom interaction' })
    ).toBeTruthy();
  });
  it('contains render failures with a safe message', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    function Broken(): never {
      throw new Error('private diagnostic');
    }
    try {
      render(
        <RuntimeBoundary>
          <Broken />
        </RuntimeBoundary>
      );
      expect(screen.getByRole('alert').textContent).toBe(
        'Experience unavailable'
      );
      expect(screen.queryByText('private diagnostic')).toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });
});
