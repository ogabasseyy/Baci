import type { ScrollViewInstance } from 'react-native';
import {
  getDataPlansErrorMessage,
  handleDataPaymentLayout,
  inferProviderFromDataBillerName,
} from './data-form.helpers';

function scrollView() {
  const scrollTo = jest.fn();
  return { scrollTo, view: { scrollTo } as unknown as ScrollViewInstance };
}

describe('getDataPlansErrorMessage', () => {
  it('is undefined while the bundles loaded', () => {
    expect(
      getDataPlansErrorMessage(false, new Error('ignored'))
    ).toBeUndefined();
  });

  it('uses the error message when there is one', () => {
    expect(getDataPlansErrorMessage(true, new Error('Billers down'))).toBe(
      'Billers down'
    );
  });

  it('falls back to a friendly line for a non-Error failure', () => {
    expect(getDataPlansErrorMessage(true, 'boom')).toBe(
      'Could not load data bundles. Please try again.'
    );
  });
});

describe('handleDataPaymentLayout', () => {
  beforeEach(() => {
    jest
      .spyOn(global, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 0;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records the position and scrolls once when asked to', () => {
    const { scrollTo, view } = scrollView();
    const paymentYRef = { current: null as number | null };
    const shouldScrollToPaymentRef = { current: true };

    handleDataPaymentLayout({
      paymentY: 400,
      paymentYRef,
      scrollView: view,
      shouldScrollToPaymentRef,
    });
    handleDataPaymentLayout({
      paymentY: 420,
      paymentYRef,
      scrollView: view,
      shouldScrollToPaymentRef,
    });

    expect(paymentYRef.current).toBe(420);
    expect(shouldScrollToPaymentRef.current).toBe(false);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ animated: true })
    );
  });

  it('only records the position when no scroll is pending', () => {
    const { scrollTo, view } = scrollView();
    const paymentYRef = { current: null as number | null };

    handleDataPaymentLayout({
      paymentY: 300,
      paymentYRef,
      scrollView: view,
      shouldScrollToPaymentRef: { current: false },
    });

    expect(paymentYRef.current).toBe(300);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('inferProviderFromDataBillerName', () => {
  it.each([
    ['MTN Data', 'mtn'],
    ['Airtel Bundles', 'airtel'],
    ['GLO data', 'glo'],
    ['9mobile Data', 't2'],
    ['Unknown', null],
  ])('maps %p to %p', (name, provider) => {
    expect(inferProviderFromDataBillerName(name)).toBe(provider);
  });
});
