import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutAccountFields } from './CheckoutAccountFields';
import { ContactHarness, validContact } from './contact.test-support';

describe('optional checkout account', () => {
  it('hides account creation for signed-in users', () => {
    render(<ContactHarness signedIn />);
    expect(
      screen.queryByRole('checkbox', { name: /Save my information/ })
    ).not.toBeInTheDocument();
  });
  it('lets guests continue without asking them to create a password', async () => {
    const user = userEvent.setup();
    render(<ContactHarness initial={validContact} />);
    expect(
      screen.queryByLabelText('Create a Password', { exact: true })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: /Save my information/ })
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Continue to Delivery' })
    );
    expect(screen.getByText('Delivery fields')).toBeVisible();
  });
  it('never establishes account authority from the save-details checkbox alone', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CheckoutAccountFields
        account={{ createAccount: false, password: '' }}
        onChange={onChange}
      />
    );
    await user.click(
      screen.getByRole('checkbox', { name: /Save my information/ })
    );
    expect(onChange).toHaveBeenCalledWith({
      createAccount: true,
      password: '',
    });
    // The checkbox only toggles local form state: no account-link or
    // authentication request may fire from it.
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
