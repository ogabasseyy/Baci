import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenContactFields } from './OxygenContactFields';

it('uses saved draft contact values before prefill and does not expose identity fields here', () => {
  render(
    <OxygenContactFields
      prefill={
        { first_name: 'Ada', last_name: 'Eze', email: 'a@example.com' } as never
      }
      defaults={{ first_name: 'Saved' }}
    />
  );
  expect(screen.getByLabelText('First name')).toHaveValue('Saved');
  expect(screen.getByLabelText('Email')).toHaveValue('a@example.com');
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(screen.queryByLabelText('NIN')).toBeNull();
});
