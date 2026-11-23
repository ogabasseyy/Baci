import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenContactFields } from './OxygenContactFields';

it('uses saved draft contact values before prefill and does not expose identity fields here', () => {
  render(
    <OxygenContactFields
      prefill={{ first_name: 'Ada', last_name: 'Eze', email: 'a@example.com' }}
      defaults={{ first_name: 'Saved' }}
    />
  );
  expect(screen.getByLabelText('First name')).toHaveValue('Saved');
  expect(screen.getByLabelText('Email')).toHaveValue('a@example.com');
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(screen.queryByLabelText('NIN')).toBeNull();
});

it('provides decorative icons and preserves prefilled contact values', () => {
  render(
    <OxygenContactFields
      prefill={{ first_name: 'Ada', last_name: 'Eze', email: 'a@example.com' }}
      defaults={{}}
    />
  );
  for (const [label, icon] of [
    ['First name', 'lucide-user-round'],
    ['Email', 'lucide-mail'],
  ] as const) {
    const input = screen.getByLabelText(label);
    expect(input).toHaveAttribute('placeholder', ' ');
    expect(input.parentElement?.querySelector(`svg.${icon}`)).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  }
});

it('carries the chat checkout contact into the secure form without asking again', () => {
  render(
    <form aria-label="Secure identity">
      <OxygenContactFields
        fromConversation
        prefill={{
          first_name: 'Ada',
          last_name: 'Obi',
          email: 'ada@example.com',
        }}
        defaults={{ first_name: 'Old draft name', middle_name: 'Saved' }}
      />
    </form>
  );
  expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  expect(screen.queryByText('Edit name and email')).not.toBeInTheDocument();
  const form = screen.getByRole<HTMLFormElement>('form', {
    name: 'Secure identity',
  });
  expect(Object.fromEntries(new FormData(form))).toEqual({
    first_name: 'Ada',
    last_name: 'Obi',
    email: 'ada@example.com',
    middle_name: 'Saved',
  });
});
