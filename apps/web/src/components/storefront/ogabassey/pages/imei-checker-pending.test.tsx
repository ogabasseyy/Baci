import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImeiCheckerPending } from './imei-checker-pending';

describe('ImeiCheckerPending', () => {
  it.each([
    false,
    true,
  ])('keeps the page open without promising resumption when storage is unavailable (paused=%s)', (paused) => {
    render(<ImeiCheckerPending paused={paused} canResume={false} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      /keep this page open/i
    );
    expect(screen.getByRole('status')).not.toHaveTextContent(
      /leave this page|close this page|check back later/i
    );
  });
  it('announces an active async check', () => {
    render(<ImeiCheckerPending paused={false} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      /usually under a minute/i
    );
  });

  it('sets expectations after foreground polling pauses', () => {
    render(<ImeiCheckerPending paused />);

    expect(screen.getByRole('status')).toHaveTextContent(/check back later/i);
  });
});
