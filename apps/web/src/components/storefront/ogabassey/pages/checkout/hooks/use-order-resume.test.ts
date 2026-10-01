import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOrderResume } from './use-order-resume';
import type { ResumedOrder } from '../types';

describe('useOrderResume', () => {
  const mockSetCheckoutFields = vi.fn();
  const mockSetPaymentTab = vi.fn();
  const mockSetPaymentMethod = vi.fn();

  const mockOrderData = {
    id: 'order-123',
    short_id: 'ORD-123',
    subtotal: 10000,
    shipping_cost: 500,
    total: 10500,
    customer_name: 'John Doe',
    customer_email: 'john@example.com',
    customer_phone: '+2348012345678',
    shipping_address: {
      address: '123 Main St',
      city: 'Lagos',
      state: 'Lagos',
      phone: '+2348012345678',
    },
    items: [
      {
        id: 'item-1',
        product_id: 'prod-1',
        product_name: 'Test Product',
        quantity: 2,
        price: 5000,
        image_url: 'https://example.com/image.jpg',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should not fetch when resumeOrderId is null', () => {
    const { result } = renderHook(() =>
      useOrderResume({
        resumeOrderId: null,
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.resumedOrder).toBeNull();
    expect(result.current.isLoadingResumedOrder).toBe(false);
    expect(result.current.resumeOrderError).toBeNull();
  });

  it('should set isLoadingResumedOrder to true initially when resumeOrderId is provided', () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOrderData,
    } as Response);

    const { result } = renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    expect(result.current.isLoadingResumedOrder).toBe(true);
  });

  it('should fetch and set resumed order on success', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOrderData,
    } as Response);

    const { result } = renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingResumedOrder).toBe(false);
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/storefront/orders/order-123');

    const expectedResumedOrder: ResumedOrder = {
      id: 'order-123',
      short_id: 'ORD-123',
      subtotal: 10000,
      shipping_cost: 500,
      tax_amount: 0,
      discount_amount: 0,
      gift_wrapping_fee: 0,
      total: 10500,
      customer_name: 'John Doe',
      customer_email: 'john@example.com',
      customer_phone: '+2348012345678',
      shipping_address: {
        address: '123 Main St',
        city: 'Lagos',
        state: 'Lagos',
        phone: '+2348012345678',
      },
      items: [
        {
          id: 'item-1',
          product_id: 'prod-1',
          product_name: 'Test Product',
          quantity: 2,
          price: 5000,
          image_url: 'https://example.com/image.jpg',
        },
      ],
    };

    expect(result.current.resumedOrder).toEqual(expectedResumedOrder);
    expect(result.current.resumeOrderError).toBeNull();
  });

  it('should parse and set checkout fields with first and last name', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOrderData,
    } as Response);

    renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(mockSetCheckoutFields).toHaveBeenCalled();
    });

    expect(mockSetCheckoutFields).toHaveBeenCalledWith({
      firstName: 'John',
      lastName: 'Doe',
      customerEmail: 'john@example.com',
      customerPhone: '+2348012345678',
      newAddressStreet: '123 Main St',
      newAddressState: 'Lagos',
      newAddressCity: 'Lagos',
      currentStep: 'payment',
      completedSteps: { contact: true, delivery: true },
    });
  });

  it('should handle customer name with multiple spaces correctly', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...mockOrderData,
        customer_name: 'John Michael Doe',
      }),
    } as Response);

    renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(mockSetCheckoutFields).toHaveBeenCalled();
    });

    expect(mockSetCheckoutFields).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'John',
        lastName: 'Michael Doe',
      }),
    );
  });

  it('should handle empty customer name', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...mockOrderData,
        customer_name: '',
      }),
    } as Response);

    renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(mockSetCheckoutFields).toHaveBeenCalled();
    });

    expect(mockSetCheckoutFields).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: '',
        lastName: '',
      }),
    );
  });

  it('should set payment tab to installments and method to credit_direct when preferredGateway is credit_direct', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOrderData,
    } as Response);

    renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: 'credit_direct',
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(mockSetPaymentTab).toHaveBeenCalled();
    });

    expect(mockSetPaymentTab).toHaveBeenCalledWith('installments');
    expect(mockSetPaymentMethod).toHaveBeenCalledWith('credit_direct');
  });

  it('should set payment tab to installments and method to credpal when preferredGateway is credpal', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOrderData,
    } as Response);

    renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: 'credpal',
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(mockSetPaymentTab).toHaveBeenCalled();
    });

    expect(mockSetPaymentTab).toHaveBeenCalledWith('installments');
    expect(mockSetPaymentMethod).toHaveBeenCalledWith('credpal');
  });

  it('should not call setPaymentTab or setPaymentMethod when preferredGateway is null', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOrderData,
    } as Response);

    renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(mockSetCheckoutFields).toHaveBeenCalled();
    });

    expect(mockSetPaymentTab).not.toHaveBeenCalled();
    expect(mockSetPaymentMethod).not.toHaveBeenCalled();
  });

  it('should handle missing shipping_address gracefully', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...mockOrderData,
        shipping_address: null,
      }),
    } as Response);

    const { result } = renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingResumedOrder).toBe(false);
    });

    expect(result.current.resumedOrder?.shipping_address).toEqual({
      address: '',
      city: '',
      state: '',
      phone: '',
    });

    expect(mockSetCheckoutFields).toHaveBeenCalledWith(
      expect.objectContaining({
        newAddressStreet: '',
        newAddressState: '',
        newAddressCity: '',
      }),
    );
  });

  it('should handle missing items gracefully', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...mockOrderData,
        items: null,
      }),
    } as Response);

    const { result } = renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingResumedOrder).toBe(false);
    });

    expect(result.current.resumedOrder?.items).toEqual([]);
  });

  it('should set error when fetch response is not ok', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingResumedOrder).toBe(false);
    });

    expect(result.current.resumeOrderError).toBe(
      'Order not found. It may have been completed or expired.',
    );
    expect(result.current.resumedOrder).toBeNull();
    expect(mockSetCheckoutFields).not.toHaveBeenCalled();
  });

  it('should set error when network request fails', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() =>
      useOrderResume({
        resumeOrderId: 'order-123',
        preferredGateway: null,
        setCheckoutFields: mockSetCheckoutFields,
        setPaymentTab: mockSetPaymentTab,
        setPaymentMethod: mockSetPaymentMethod,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingResumedOrder).toBe(false);
    });

    expect(result.current.resumeOrderError).toBe('Failed to load order details. Please try again.');
    expect(result.current.resumedOrder).toBeNull();
    expect(mockSetCheckoutFields).not.toHaveBeenCalled();
  });
});
