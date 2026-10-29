import {
  act,
  CheckoutPage,
  expect,
  fireEvent,
  it,
  render,
  screen,
  useCart,
  usePersistedForm,
  vi,
} from './checkout-page-test-support';

it('debounces inferred manual address location updates before mutating checkout location', async () => {
  vi.useFakeTimers();
  const setValue = vi.fn();
  const setValues = vi.fn();

  vi.mocked(useCart).mockReturnValue({
    cart: [
      {
        id: 'item-1',
        name: 'Test Product',
        price: 5000,
        quantity: 1,
        image: '',
        slug: 'test-product',
      },
    ],
    cartTotal: 5000,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  vi.mocked(usePersistedForm).mockReturnValue({
    values: {
      firstName: 'Ada',
      lastName: 'Buyer',
      customerEmail: 'ada@example.com',
      customerPhone: '+2348123456789',
      newAddressStreet: '',
      newAddressState: '',
      newAddressCity: '',
      currentStep: 'delivery',
      completedSteps: { contact: true, delivery: false },
    },
    setValue,
    setValues,
    clear: vi.fn(),
  } as unknown as ReturnType<typeof usePersistedForm>);

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ states: ['Lagos'], locations: [] }),
    text: async () => '',
  } as Response);

  try {
    const { unmount } = render(<CheckoutPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/shipping/locations',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    fireEvent.change(screen.getByTestId('address-input'), {
      target: { value: 'Lekki, Lagos' },
    });

    expect(setValues).toHaveBeenCalledWith({
      newAddressStreet: 'Lekki, Lagos',
      newAddressCity: '',
      newAddressState: '',
      deliveryCoordinates: null,
    });
    setValues.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });

    expect(setValues).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(setValues).toHaveBeenCalledWith({
      newAddressCity: 'Lekki',
      newAddressState: 'Lagos',
    });

    unmount();
  } finally {
    fetchMock.mockRestore();
    vi.useRealTimers();
  }
});

it('preserves visible city/state when the customer corrects the street without a parseable locality', async () => {
  vi.useFakeTimers();
  const setValue = vi.fn();
  const setValues = vi.fn();

  vi.mocked(useCart).mockReturnValue({
    cart: [
      {
        id: 'item-1',
        name: 'Test Product',
        price: 5000,
        quantity: 1,
        image: '',
        slug: 'test-product',
      },
    ],
    cartTotal: 5000,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  vi.mocked(usePersistedForm).mockReturnValue({
    values: {
      firstName: 'Ada',
      lastName: 'Buyer',
      customerEmail: 'ada@example.com',
      customerPhone: '+2348123456789',
      newAddressStreet: '',
      newAddressState: '',
      newAddressCity: '',
      currentStep: 'delivery',
      completedSteps: { contact: true, delivery: false },
    },
    setValue,
    setValues,
    clear: vi.fn(),
  } as unknown as ReturnType<typeof usePersistedForm>);

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ states: ['Lagos'], locations: [] }),
    text: async () => '',
  } as Response);

  try {
    render(<CheckoutPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/shipping/locations',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    fireEvent.change(screen.getByTestId('address-input'), {
      target: { value: 'Lekki, Lagos' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(setValues).toHaveBeenCalledWith({
      newAddressCity: 'Lekki',
      newAddressState: 'Lagos',
    });

    setValues.mockClear();
    fireEvent.change(screen.getByTestId('address-input'), {
      target: { value: 'Lekki, Nigeria' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByLabelText('City / Town')).toHaveValue('Lekki');
    expect(screen.getByLabelText('State')).toHaveValue('Lagos');
    expect(setValues).toHaveBeenCalledWith({
      newAddressStreet: 'Lekki, Nigeria',
      deliveryCoordinates: null,
    });
    expect(setValues).not.toHaveBeenCalledWith(
      expect.objectContaining({ newAddressCity: '' })
    );
  } finally {
    fetchMock.mockRestore();
    vi.useRealTimers();
  }
});
