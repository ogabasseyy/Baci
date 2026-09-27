import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ContactHarness, validContact } from './contact.test-support';

describe('optional checkout account', () => {
  it('hides account creation for signed-in users', () => {
    render(<ContactHarness signedIn />);
    expect(
      screen.queryByRole('checkbox', { name: /Save my information/ })
    ).not.toBeInTheDocument();
  });
  it('keeps password controls hidden until opted in, and supports show/hide', async () => {
    const user = userEvent.setup();
    render(<ContactHarness initial={validContact} />);
    const password = screen.getByLabelText('Create a Password', {
      exact: true,
    });
    expect(password).not.toBeVisible();
    await user.click(
      screen.getByRole('checkbox', { name: /Save my information/ })
    );
    expect(password).toBeVisible();
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    await user.type(password, 'secret123');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
    await user.click(
      screen.getByRole('checkbox', { name: /Save my information/ })
    );
    expect(password).not.toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Show password' })
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Continue to Delivery' })
    );
    expect(screen.getByText('Delivery fields')).toBeVisible();
  });
  it('focuses a short password and advances only when corrected', async () => {
    const user = userEvent.setup();
    render(
      <ContactHarness
        initial={validContact}
        initialAccount={{ createAccount: true, password: '12345' }}
      />
    );
    await user.click(
      screen.getByRole('button', { name: 'Continue to Delivery' })
    );
    const password = screen.getByLabelText('Create a Password', {
      exact: true,
    });
    expect(password).toHaveFocus();
    expect(password).toHaveAccessibleDescription(
      'Password must be at least 6 characters'
    );
    await user.type(password, '6');
    await user.click(
      screen.getByRole('button', { name: 'Continue to Delivery' })
    );
    expect(screen.getByText('Delivery fields')).toBeVisible();
  });
});
