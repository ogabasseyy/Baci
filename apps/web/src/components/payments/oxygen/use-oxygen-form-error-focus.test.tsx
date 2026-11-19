import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { expect, it } from 'vitest';
import { useOxygenFormErrorFocus } from './use-oxygen-form-error-focus';

function Example({ error, invalid }: { error: string; invalid: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const focusedInvalid = useRef(invalid);
  useOxygenFormErrorFocus(form, error, focusedInvalid);
  return (
    <form ref={form}>
      <div role="alert" tabIndex={-1}>
        {error}
      </div>
    </form>
  );
}

it('focuses the alert unless an invalid field was already selected', () => {
  const { unmount } = render(<Example error="Error" invalid={false} />);
  expect(screen.getByRole('alert')).toHaveFocus();
  unmount();
  render(<Example error="Error" invalid />);
  expect(screen.getByRole('alert')).not.toHaveFocus();
});
