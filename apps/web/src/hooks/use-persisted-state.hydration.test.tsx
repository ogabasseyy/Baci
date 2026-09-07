import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePersistedForm } from './use-persisted-state';

function ContactForm() {
  const { values } = usePersistedForm('checkout-form', { firstName: '' });
  return (
    <input
      aria-label="First name"
      className={values.firstName ? 'filled' : 'empty'}
      value={values.firstName}
      readOnly
    />
  );
}

describe('persisted checkout hydration', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it.each([
    {
      stored: JSON.stringify({ firstName: 'Checkout' }),
      expected: 'Checkout',
      className: 'filled',
    },
    { stored: '{invalid json', expected: '', className: 'empty' },
  ])('hydrates safely with stored value $stored', async ({
    stored,
    expected,
    className,
  }) => {
    sessionStorage.clear();
    const container = document.createElement('div');
    container.innerHTML = renderToString(<ContactForm />);
    document.body.append(container);
    sessionStorage.setItem('checkout-form', stored);
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <ContactForm />);
      });
      expect(errors).not.toHaveBeenCalled();
      expect(container.querySelector('input')).toHaveValue(expected);
      expect(container.querySelector('input')).toHaveClass(className);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
