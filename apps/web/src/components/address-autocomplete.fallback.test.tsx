import { act, fireEvent, render, screen } from '@testing-library/react';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getPlaceDetails, getPlacePredictions } from '@/lib/google-places';
import { AddressAutocomplete } from './address-autocomplete';

// Exit animations are browser concerns; selection/reset assertions are immediate.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: ComponentProps<'div'> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <div {...props} />,
  },
}));

vi.mock('@/lib/google-places', () => ({
  generateSessionToken: () => 'session',
  getPlacePredictions: vi.fn(),
  getPlaceDetails: vi.fn(),
}));
const geo = {
  provider: 'geoapify' as const,
  placeId: 'geoapify:id',
  mainText: '20 Allen Avenue',
  secondaryText: 'Ikeja, Lagos',
  fullText: '20 Allen Avenue, Ikeja, Lagos',
  details: {
    placeId: 'geoapify:id',
    formattedAddress: '20 Allen Avenue, Ikeja, Lagos',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'Nigeria',
    location: { latitude: 6.6, longitude: 3.3 },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
async function search(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

it('selects Geoapify details and keeps its attribution after the dropdown closes', async () => {
  vi.mocked(getPlacePredictions).mockResolvedValue([geo]);
  const onSelect = vi.fn();
  render(
    <AddressAutocomplete
      aria-label="Address"
      country="NG"
      onSelect={onSelect}
    />
  );
  await search(
    screen.getByRole('textbox', { name: 'Address' }),
    'Allen Avenue'
  );
  expect(screen.getByRole('link', { name: 'Geoapify' })).toHaveAttribute(
    'href',
    'https://www.geoapify.com/'
  );
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: /20 Allen Avenue/ }))
  );
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({
      city: 'Ikeja',
      state: 'Lagos',
      location: geo.details.location,
    })
  );
  expect(getPlaceDetails).not.toHaveBeenCalled();
  expect(
    screen.getAllByRole('link', { name: /OpenStreetMap/ }).at(-1)
  ).toBeVisible();
});
it('keeps manual text editable when both providers fail and clears the error after recovery', async () => {
  vi.mocked(getPlacePredictions)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce([geo]);
  const onChange = vi.fn();
  const onError = vi.fn();
  render(
    <AddressAutocomplete
      aria-label="Address"
      onChange={onChange}
      onError={onError}
    />
  );
  const input = screen.getByRole('textbox', { name: 'Address' });
  await search(input, '20 Allen Avenue, Ikeja, Lagos');
  expect(input).toHaveValue('20 Allen Avenue, Ikeja, Lagos');
  expect(screen.getByRole('status')).toHaveTextContent(/manually/);
  expect(onError).toHaveBeenLastCalledWith(true);
  await search(input, '20 Allen Avenue');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(onError).toHaveBeenLastCalledWith(false);
});
it('clearing an input cancels its debounced provider call', async () => {
  render(<AddressAutocomplete aria-label="Address" />);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Allen Avenue' },
  });
  // The loading indicator replaces the clear button; clearing by text edit
  // must still invalidate the pending debounce.
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(getPlacePredictions).not.toHaveBeenCalled();
});

function ControlledAddress({
  onError,
}: {
  onError?: (failed: boolean) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <>
      <AddressAutocomplete
        aria-label="Address"
        value={value}
        onError={onError}
        onChange={(change) =>
          setValue(typeof change === 'string' ? change : change.target.value)
        }
        onSelect={(place) => setValue(place.formattedAddress)}
      />
      <button type="button" onClick={() => setValue('')}>
        Reset form
      </button>
      <button type="button" onClick={() => setValue('Different saved address')}>
        Load another address
      </button>
    </>
  );
}

it.each([
  'Reset form',
  'Load another address',
])('removes selected-provider attribution when the parent invokes %s', async (action) => {
  vi.mocked(getPlacePredictions).mockResolvedValue([geo]);
  render(<ControlledAddress />);
  await search(
    screen.getByRole('textbox', { name: 'Address' }),
    'Allen Avenue'
  );
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: /20 Allen Avenue/ }))
  );
  // The parent's own selection update must retain credit for the formatted value.
  expect(screen.getByRole('textbox')).toHaveValue(geo.details.formattedAddress);
  expect(
    screen.getAllByRole('link', { name: 'Geoapify' }).at(-1)
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: action }));
  expect(
    screen.queryByRole('link', { name: 'Geoapify' })
  ).not.toBeInTheDocument();
});

it.each([
  'Reset form',
  'Load another address',
])('clears failed suggestions and notifies recovery when the parent invokes %s', async (action) => {
  vi.mocked(getPlacePredictions).mockRejectedValue(new Error('Unavailable'));
  const onError = vi.fn();
  render(<ControlledAddress onError={onError} />);
  await search(
    screen.getByRole('textbox', { name: 'Address' }),
    'Allen Avenue'
  );
  expect(screen.getByRole('status')).toHaveTextContent(/unavailable/);
  expect(onError).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: action }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(onError).toHaveBeenLastCalledWith(false);
});
