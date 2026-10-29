import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AddressAutocomplete } from './address-autocomplete';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('retires a Google session when Details starts, even if the shopper types before it finishes', async () => {
  vi.useFakeTimers();
  vi.spyOn(crypto, 'randomUUID')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    .mockReturnValue('00000000-0000-4000-8000-000000000002');
  const requests: URL[] = [];
  let completeDetails: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'https://checkout.example.test');
      requests.push(url);
      if (url.pathname.endsWith('/details')) {
        return new Promise<Response>((resolve) => {
          completeDetails = resolve;
        });
      }
      return Response.json({
        predictions: [
          {
            placeId: 'fixture-google-place',
            mainText: '12 Sample Street',
            secondaryText: 'Ikeja, Lagos',
            fullText: '12 Sample Street, Ikeja, Lagos',
          },
        ],
      });
    })
  );
  const onSelect = vi.fn();
  render(<AddressAutocomplete aria-label="Address" onSelect={onSelect} />);
  const input = screen.getByRole('textbox', { name: 'Address' });
  fireEvent.change(input, { target: { value: '12 Sample Street' } });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const firstToken = requests[0].searchParams.get('sessionToken');
  expect(firstToken).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /12 Sample Street/ }));
  expect(requests[1].searchParams.get('sessionToken')).toBe(firstToken);

  fireEvent.change(input, { target: { value: '14 Different Street' } });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const nextToken = requests[2].searchParams.get('sessionToken');
  expect(nextToken).toBeTruthy();
  expect(nextToken).not.toBe(firstToken);

  await act(async () =>
    completeDetails?.(
      Response.json({
        details: {
          placeId: 'fixture-google-place',
          formattedAddress: '12 Sample Street, Ikeja, Lagos',
          city: 'Ikeja',
          state: 'Lagos',
          location: { latitude: 6.6, longitude: 3.3 },
        },
      })
    )
  );
  expect(onSelect).not.toHaveBeenCalled();
  expect(input).toHaveValue('14 Different Street');
  fireEvent.change(input, { target: { value: '14 Different Street Lagos' } });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(requests[3].searchParams.get('sessionToken')).toBe(nextToken);
});
