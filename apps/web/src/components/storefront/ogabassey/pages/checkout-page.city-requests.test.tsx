import {
  act,
  addressAutocompleteMock,
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockCheckoutSubmissionState,
  render,
  screen,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('detects the selected address without fetching unused city lists on state changes', async () => {
  mockCheckoutSubmissionState();
  addressAutocompleteMock.selectedPlace = {
    formattedAddress: '10 Test Street, Wuse, Abuja',
    state: 'FCT',
    city: 'Wuse',
    location: { latitude: 9.0765, longitude: 7.3986 },
  };
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/shipping/locations')) {
        return new Response(
          JSON.stringify({ states: ['Lagos', 'FCT'], locations: [] })
        );
      }
      return new Response(JSON.stringify({ quotes: [] }));
    });
  try {
    render(<CheckoutPage />);
    await waitFor(() =>
      expect(screen.getByText('Detected: Ikeja, Lagos')).toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/shipping/locations',
      expect.anything()
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Select address place' })
    );
    await waitFor(() =>
      expect(screen.getByText('Detected: Wuse, FCT')).toBeInTheDocument()
    );
    await act(async () => {});
    const cityRequests = fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith('/api/shipping/locations?state=')
    );
    expect(cityRequests).toHaveLength(0);
  } finally {
    fetchMock.mockRestore();
  }
});
