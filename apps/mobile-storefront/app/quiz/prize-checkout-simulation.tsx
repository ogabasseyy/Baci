import { useLocalSearchParams } from 'expo-router';
import { QuizPrizeCheckoutSimulationScreen } from '@/components/quiz/QuizPrizeCheckoutSimulationScreen';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import type { QuizPrizeCondition } from '@/services/quiz-types';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function QuizPrizeCheckoutSimulationRoute() {
  const params = useLocalSearchParams<{
    condition?: string;
    imageUrl?: string;
    name?: string;
    productId?: string;
    variantId?: string;
  }>();
  const productId = first(params.productId) ?? 'test-prize';

  return (
    <StorefrontScreenShell edges={[]} testID="quiz-prize-checkout-shell">
      <QuizPrizeCheckoutSimulationScreen
        prize={{
          condition: (first(params.condition) ||
            null) as QuizPrizeCondition | null,
          id: productId,
          imageUrl: first(params.imageUrl) || null,
          name: first(params.name) || 'Quiz prize',
          variantId: first(params.variantId) || null,
        }}
      />
    </StorefrontScreenShell>
  );
}
