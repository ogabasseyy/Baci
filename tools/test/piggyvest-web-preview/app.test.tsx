import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PreviewApp } from './app';

const network = vi.fn(() => {
  throw new Error('Network prohibited');
});
beforeEach(() => {
  network.mockClear();
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  cleanup();
  vi.unstubAllGlobals();
});
async function accept() {
  fireEvent.click(
    await screen.findByRole('checkbox', {
      name: 'I accept the supplied terms for this draft.',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Accept draft terms' }));
  await screen.findByText('Consent recorded for this draft.');
}

it('adds isolated synthetic cancellation without changing savings controls', () => {
  render(<PreviewApp />);
  const cancellation = screen.getByRole('region', {
    name: 'Synthetic cancellation fixture',
  });
  expect(within(cancellation).getByText('Principal: NGN 100.00')).toBeVisible();
  fireEvent.change(within(cancellation).getByLabelText('Cancellation goal'), {
    target: { value: 'b' },
  });
  expect(screen.getByLabelText('Exact variant and condition')).toHaveValue(
    'green'
  );
  expect(screen.getByLabelText('Synthetic session present')).toBeChecked();
  fireEvent.click(within(cancellation).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Exact variant and condition'), {
    target: { value: 'blue' },
  });
  expect(within(cancellation).getByRole('checkbox')).toBeChecked();
  expect(within(cancellation).getByLabelText('Cancellation goal')).toHaveValue(
    'b'
  );
});
function eligibility(value: string) {
  fireEvent.change(screen.getByLabelText('Synthetic trusted eligibility'), {
    target: { value },
  });
}

it('renders the actual screen and requires separate eligibility after consent', async () => {
  render(<PreviewApp />);
  expect(
    screen.getByRole('region', { name: 'Staging savings journey' })
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText('Funding response'), {
    target: { value: 'ready' },
  });
  expect(screen.queryByText('NOT-A-BANK-ACCOUNT')).toBeNull();
  await accept();
  expect(screen.queryByText('NOT-A-BANK-ACCOUNT')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Customer savings' })).toBeNull();
  expect(screen.getByLabelText('Synthetic trusted eligibility')).toHaveValue(
    'blocked'
  );
  eligibility('allowed');
  expect(await screen.findByText('NOT-A-BANK-ACCOUNT')).toBeVisible();
  expect(
    screen.getByRole('region', { name: 'Customer savings' })
  ).toBeVisible();
});

it('resets consent, eligibility and stale details on exact variant change', async () => {
  render(<PreviewApp />);
  await accept();
  eligibility('allowed');
  fireEvent.change(screen.getByLabelText('Funding response'), {
    target: { value: 'ready' },
  });
  await screen.findByText('NOT-A-BANK-ACCOUNT');
  fireEvent.change(screen.getByLabelText('Exact variant and condition'), {
    target: { value: 'blue' },
  });
  expect(screen.queryByText('NOT-A-BANK-ACCOUNT')).toBeNull();
  const policy = screen.getByRole('region', { name: 'Draft policy review' });
  expect(await within(policy).findByText('256 GB / Blue')).toBeVisible();
  expect(within(policy).getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByLabelText('Synthetic trusted eligibility')).toHaveValue(
    'blocked'
  );
  await accept();
  expect(screen.queryByText('NOT-A-BANK-ACCOUNT')).toBeNull();
  eligibility('allowed');
  expect(await screen.findByText('NOT-A-BANK-ACCOUNT')).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'Customer savings' })).getByText(
      '256 GB / Blue'
    )
  ).toBeVisible();
});

it('clears details and resets consent after logout and login', async () => {
  render(<PreviewApp />);
  await accept();
  eligibility('allowed');
  fireEvent.change(screen.getByLabelText('Funding response'), {
    target: { value: 'ready' },
  });
  await screen.findByText('NOT-A-BANK-ACCOUNT');
  fireEvent.click(screen.getByLabelText('Synthetic session present'));
  expect(screen.queryByText('NOT-A-BANK-ACCOUNT')).toBeNull();
  expect(screen.getByText('Sign in to view staging savings.')).toBeVisible();
  fireEvent.click(screen.getByLabelText('Synthetic session present'));
  expect(
    await screen.findByRole('checkbox', {
      name: 'I accept the supplied terms for this draft.',
    })
  ).not.toBeChecked();
  expect(screen.getByLabelText('Synthetic trusted eligibility')).toHaveValue(
    'blocked'
  );
});

it('shows simulated consent errors without unlocking funding', async () => {
  render(<PreviewApp />);
  fireEvent.click(screen.getByLabelText('Simulate consent failure'));
  fireEvent.click(
    await screen.findByRole('checkbox', {
      name: 'I accept the supplied terms for this draft.',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Accept draft terms' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Acceptance could not be confirmed'
  );
  expect(screen.queryByText('NOT-A-BANK-ACCOUNT')).toBeNull();
  expect(screen.getByLabelText('Synthetic trusted eligibility')).toHaveValue(
    'blocked'
  );
});

it('renders pending/error states without stale account details', async () => {
  render(<PreviewApp />);
  await accept();
  eligibility('pending');
  expect(screen.getByText('Server eligibility is pending.')).toBeVisible();
  eligibility('unavailable');
  expect(screen.getByText('Server eligibility is unavailable.')).toBeVisible();
  eligibility('allowed');
  expect(await screen.findByText(/funding.*pending/i)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Funding response'), {
    target: { value: 'ready' },
  });
  await screen.findByText('NOT-A-BANK-ACCOUNT');
  fireEvent.change(screen.getByLabelText('Funding response'), {
    target: { value: 'unavailable' },
  });
  expect(screen.queryByText('NOT-A-BANK-ACCOUNT')).toBeNull();
  expect(
    await screen.findByText('Test funding details are unavailable.')
  ).toBeVisible();
});

it('shows actual progress loading, pending and unavailable states', async () => {
  render(<PreviewApp />);
  await accept();
  eligibility('allowed');
  for (const [value, message] of [
    ['loading', 'Loading savings status…'],
    ['pending_wallet', 'Your savings wallet is pending confirmation.'],
    ['unavailable', 'Savings status is unavailable. Please try again later.'],
  ]) {
    fireEvent.change(screen.getByLabelText('Savings progress'), {
      target: { value },
    });
    const progress = screen.getByRole('region', { name: 'Customer savings' });
    expect(within(progress).getByText(message)).toBeVisible();
    expect(
      within(progress).queryByText('Server-confirmed purchasing power')
    ).toBeNull();
  }
});
