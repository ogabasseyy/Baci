import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { OxygenVerificationForms } from './OxygenVerificationForms';

it('submits approval OTP and signature transiently, then clears the form', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenVerificationForms
      stage="approval_required"
      address={{}}
      approvalOtpReady
      busy={false}
      submit={submit}
    />
  );
  fireEvent.change(screen.getByLabelText('Approval OTP'), {
    target: { value: '123456' },
  });
  const signature = new File(['signature'], 'signature.png', {
    type: 'image/png',
  });
  fireEvent.change(screen.getByLabelText('Signature image'), {
    target: { files: [signature] },
  });
  fireEvent.click(screen.getByLabelText('I accept the displayed loan offer'));
  fireEvent.submit(screen.getByRole('form', { name: 'Accept loan offer' }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      { action: 'approve_booking', otp: '123456', accepted: true },
      signature
    )
  );
  expect(screen.getByLabelText('Approval OTP')).toHaveValue('');
  expect(screen.queryByRole('button', { name: /activate/i })).toBeNull();
});
it('collects address details and accepts PDF or image uploads', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenVerificationForms
      stage="booked"
      address={{
        state: 'Lagos',
        city: 'Ikeja',
        lga: 'Ikeja',
        street: 'Street',
        landmark: 'Mall',
        house_number: '1',
      }}
      approvalOtpReady={false}
      busy={false}
      submit={submit}
    />
  );
  const bill = new File(['bill'], 'bill.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Proof of address'), {
    target: { files: [bill] },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Verify address' }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      {
        action: 'submit_address',
        state: 'Lagos',
        city: 'Ikeja',
        lga: 'Ikeja',
        street: 'Street',
        landmark: 'Mall',
        house_number: '1',
      },
      bill
    )
  );
});

it('shows one phone task and loading feedback while blocking duplicate submissions', async () => {
  let finish: () => void = () => {};
  const submit = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      })
  );
  render(
    <OxygenVerificationForms
      stage="eligibility_required"
      address={{}}
      approvalOtpReady={false}
      busy={false}
      submit={submit}
    />
  );
  expect(
    screen.getByRole('heading', { name: 'Verify your phone' })
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText('Verification code'), {
    target: { value: '123456' },
  });
  const form = screen.getByRole('form', { name: 'Verify phone' });
  fireEvent.submit(form);
  expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Verifying…' })).toHaveAttribute(
    'aria-busy',
    'true'
  );
  expect(screen.getByRole('button', { name: 'Resend code' })).toBeDisabled();
  fireEvent.submit(form);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith({
    action: 'validate_customer',
    otp: '123456',
  });
  finish();
  await waitFor(() =>
    expect(screen.getByLabelText('Verification code')).toBeEnabled()
  );
  expect(screen.getByLabelText('Verification code')).toHaveValue('');
});
it('shows a sending state only on the secondary resend action', async () => {
  let finish: () => void = () => {};
  const submit = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      })
  );
  render(
    <OxygenVerificationForms
      stage="eligibility_required"
      address={{}}
      approvalOtpReady={false}
      busy={false}
      submit={submit}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Verify phone' })).toBeDisabled();
  expect(submit).toHaveBeenCalledWith({ action: 'resend_customer_otp' });
  finish();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled()
  );
});

it('shows safe feedback and releases the phone action after failure', async () => {
  const submit = vi
    .fn()
    .mockRejectedValue(new Error('private provider detail'));
  render(
    <OxygenVerificationForms
      stage="eligibility_required"
      address={{}}
      approvalOtpReady={false}
      busy={false}
      submit={submit}
    />
  );
  fireEvent.change(screen.getByLabelText('Verification code'), {
    target: { value: '123456' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Verify phone' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'We could not confirm this step'
  );
  expect(screen.queryByText(/private provider detail/)).toBeNull();
  expect(screen.getByLabelText('Verification code')).toBeEnabled();
});

it('automatically verifies exactly once when the sixth digit is entered', async () => {
  let finish: () => void = () => {};
  const submit = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      })
  );
  render(
    <OxygenVerificationForms
      stage="eligibility_required"
      address={{}}
      approvalOtpReady={false}
      busy={false}
      submit={submit}
    />
  );
  const code = screen.getByLabelText('Verification code');
  fireEvent.change(code, { target: { value: '01234' } });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(code, { target: { value: '012345' } });
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      action: 'validate_customer',
      otp: '012345',
    })
  );
  fireEvent.submit(screen.getByRole('form', { name: 'Verify phone' }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('heading', { name: 'Phone verified' })).toBeNull();
  finish();
  await waitFor(() => expect(code).toHaveValue(''));
  expect(screen.queryByRole('heading', { name: 'Phone verified' })).toBeNull();
});
it('only displays verified success when the provider snapshot confirms it', () => {
  const submit = vi.fn();
  render(
    <OxygenVerificationForms
      stage="eligibility_required"
      address={{}}
      approvalOtpReady={false}
      validated
      busy={false}
      submit={submit}
    />
  );
  expect(screen.getByRole('heading', { name: 'Phone verified' })).toBeVisible();
  expect(screen.queryByRole('form', { name: 'Verify phone' })).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterAll(() => vi.unstubAllGlobals());

it('pastes a complete code with spaces and submits it once', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenVerificationForms
      stage="eligibility_required"
      address={{}}
      approvalOtpReady={false}
      busy={false}
      submit={submit}
    />
  );
  const input = screen.getByLabelText('Verification code');
  fireEvent.focus(input);
  fireEvent.paste(input, { clipboardData: { getData: () => '123 456' } });
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      action: 'validate_customer',
      otp: '123456',
    })
  );
  expect(submit).toHaveBeenCalledTimes(1);
});

// input-otp queues selection updates at 0/10/50 ms after focus and paste.
// Let those library callbacks finish before Vitest tears down this JSDOM window.
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});
