import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenAddressProgress } from './OxygenAddressProgress';

it('explains prolonged processing as needing a manual review without another upload', () => {
  const onCheck = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenAddressProgress submitted delayed manualReview onCheck={onCheck} />
  );
  expect(
    screen.getByRole('heading', { name: 'Oxygen is reviewing your address' })
  ).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Oxygen is currently reviewing your address details.'
  );
  expect(screen.getByRole('status')).not.toHaveTextContent(
    'Your document was received'
  );
  expect(screen.queryByLabelText('Proof of address')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check for an update' }));
  expect(onCheck).toHaveBeenCalledTimes(1);
});
it('keeps temporary status failures separate from the manual-review message', () => {
  render(
    <OxygenAddressProgress submitted delayed manualReview statusUnavailable />
  );
  expect(
    screen.getByRole('heading', {
      name: 'We couldn’t check your address status',
    })
  ).toBeVisible();
  expect(screen.getByRole('status')).not.toHaveTextContent(
    'Oxygen needs to review'
  );
});
it('does not prematurely claim manual review during the first processing checks', () => {
  render(<OxygenAddressProgress submitted />);
  expect(
    screen.getByRole('heading', { name: 'Oxygen is reviewing your address' })
  ).toBeVisible();
  expect(screen.getByRole('status')).not.toHaveTextContent('manual review');
});

it('keeps prolonged processing status-only even when a replacement handler exists', () => {
  const onReplace = vi.fn();
  const onCheck = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenAddressProgress
      submitted
      delayed
      manualReview
      onReplace={onReplace}
      onCheck={onCheck}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'Upload another proof' })
  ).toBeNull();
  const check = screen.getByRole('button', { name: 'Check for an update' });
  expect(check).toHaveClass('bg-store-primary');
  fireEvent.click(check);
  expect(onReplace).not.toHaveBeenCalled();
  expect(onCheck).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).not.toHaveTextContent(
    'Your document was received'
  );
});

it('does not promise an unwired email or push notification', () => {
  render(<OxygenAddressProgress submitted delayed manualReview />);
  expect(screen.getByRole('status')).not.toHaveTextContent(
    /notification|email|push/i
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Your application stays saved'
  );
});

it('offers the primary status check during processing and disables it while checking', () => {
  const check = vi.fn().mockResolvedValue(undefined);
  render(<OxygenAddressProgress submitted busy onCheck={check} />);
  expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Upload another proof' })
  ).toBeNull();
});
