import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { CheckoutScreenView } from '@/components/checkout/CheckoutScreenView';
import { createCheckoutQueryClient } from './checkout.test-utils';

export function renderCheckoutScreenView(props: Record<string, unknown> = {}) {
  const queryClient = createCheckoutQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <CheckoutScreenView {...props} />
    </QueryClientProvider>
  );
}
