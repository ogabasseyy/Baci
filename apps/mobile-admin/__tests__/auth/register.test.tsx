// biome-ignore assist/source/organizeImports: harness mocks must load before RegisterScreen.
import {
  fillFormAndSubmit,
  getRegisterScreenMocks,
} from './register-screen-test-harness';
import fs from 'node:fs';
import path from 'node:path';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RegisterScreen from '../../app/(auth)/register';
import { APP_KEYBOARD_CONTAINER_LABEL } from './app-keyboard-container.mock';

const mocks = getRegisterScreenMocks();

describe('RegisterScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signUp.mockResolvedValue({
      error: null,
      sessionEstablished: true,
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not repeat the merchant setup progress before account creation', () => {
    render(<RegisterScreen />);

    expect(screen.getByText("Let's get to know you")).toBeTruthy();
    expect(screen.getByText('Your details')).toBeTruthy();
    expect(screen.queryByText('Your store setup')).toBeNull();
    expect(screen.queryByText('About you')).toBeNull();
    expect(screen.queryByText('Your business')).toBeNull();
  });

  it('creates the native account exactly once with sentence-cased metadata', async () => {
    render(<RegisterScreen />);
    expect(
      screen.getByRole('region', { name: APP_KEYBOARD_CONTAINER_LABEL })
    ).toBeTruthy();

    const submitButton = screen.getByRole('button', {
      name: 'Proceed to next step',
    });
    fillFormAndSubmit();
    fireEvent.click(submitButton);

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledTimes(1));
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'StrongP@ss123!',
      firstName: 'Test',
      lastName: 'User',
      fullName: 'Test User',
      signupFlow: 'merchant',
    });
  });

  it('trims identity fields while preserving password whitespace exactly', async () => {
    render(<RegisterScreen />);
    fireEvent.change(screen.getByPlaceholderText('John'), {
      target: { value: ' mary ann ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Doe'), {
      target: { value: ' van buren ' },
    });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: ' person@example.com ' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: ' Strong P@ss123! ' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: ' Strong P@ss123! ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Proceed to next step' })
    );

    await waitFor(() =>
      expect(mocks.signUp).toHaveBeenCalledWith({
        email: 'person@example.com',
        password: ' Strong P@ss123! ',
        firstName: 'Mary ann',
        lastName: 'Van buren',
        fullName: 'Mary ann Van buren',
        signupFlow: 'merchant',
      })
    );
  });

  it('routes a returned session to authenticated profile completion', async () => {
    render(<RegisterScreen />);
    fillFormAndSubmit();

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith('/(auth)/complete-profile');
    });
  });

  it('routes confirmation-required signup to email verification', async () => {
    mocks.signUp.mockResolvedValue({
      error: null,
      needsEmailConfirmation: true,
      signupAttemptId: '123e4567-e89b-42d3-a456-426614174000',
    });
    render(<RegisterScreen />);
    fillFormAndSubmit();

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        '/(auth)/verify?email=test%40example.com&attemptId=123e4567-e89b-42d3-a456-426614174000&flow=merchant'
      );
    });
  });

  it('routes confirmation-required signup without an attempt ID to email verification', async () => {
    mocks.signUp.mockResolvedValue({
      error: null,
      needsEmailConfirmation: true,
    });
    render(<RegisterScreen />);
    fillFormAndSubmit();

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        '/(auth)/verify?email=test%40example.com&flow=merchant'
      );
    });
  });

  it('offers sign-in for an existing account without blaming the store URL', async () => {
    mocks.signUp.mockResolvedValue({ error: null, accountExists: true });
    render(<RegisterScreen />);
    fillFormAndSubmit();

    await waitFor(() => expect(mocks.alert).toHaveBeenCalled());
    const [title, message, buttons] = mocks.alert.mock.calls[0] as [
      string,
      string,
      Array<{ text: string; onPress?: () => void }>,
    ];
    expect(title).toBe('Account Exists');
    expect(message).toBe(
      'An account with this email already exists. Please sign in instead.'
    );
    expect(message.toLowerCase()).not.toContain('store');
    buttons.find((button) => button.text === 'Sign In')?.onPress?.();
    expect(mocks.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it.each([
    'Too many attempts. Please wait a minute and try again.',
    'Unable to connect. Please check your internet connection.',
    'Password is too weak.',
  ])('keeps the account screen open for auth error: %s', async (error) => {
    mocks.signUp.mockResolvedValue({ error });
    render(<RegisterScreen />);
    fillFormAndSubmit();

    await waitFor(() => {
      expect(mocks.alert).toHaveBeenCalledWith('Sign Up Failed', error);
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('does not erase the auth-store session if the screen unmounts during signup', async () => {
    const signup = Promise.withResolvers<{
      error: null;
      sessionEstablished: true;
    }>();
    mocks.signUp.mockReturnValue(signup.promise);
    const rendered = render(<RegisterScreen />);

    fillFormAndSubmit();
    rendered.unmount();
    await act(async () => {
      signup.resolve({ error: null, sessionEstablished: true });
      await signup.promise;
    });

    expect(mocks.signUp).toHaveBeenCalledOnce();
  });

  it('disables account submission while signup is in flight', async () => {
    const signup = Promise.withResolvers<{
      error: null;
      sessionEstablished: true;
    }>();
    mocks.signUp.mockReturnValue(signup.promise);
    render(<RegisterScreen />);

    fillFormAndSubmit();

    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Creating account...',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true)
    );
    await act(async () => {
      signup.resolve({ error: null, sessionEstablished: true });
      await signup.promise;
    });
  });

  it('contains no server-owned onboarding or automatic sign-in fallback', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'app/(auth)/register.tsx'),
      'utf8'
    );

    expect(source).not.toContain('/api/mobile-onboarding');
    expect(source).not.toContain('/api/mobile/merchant-provisioning');
    expect(source).not.toContain('signIn(');
    expect(source).not.toContain('useRegistration');
  });
});
