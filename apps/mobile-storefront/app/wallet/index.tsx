import { useLocalSearchParams } from 'expo-router';
import { WalletScreen } from '@/components/wallet/WalletScreen';

interface WalletRouteProps {
  presentation?: 'stack' | 'tab';
}

export default function WalletRoute({
  presentation = 'stack',
}: WalletRouteProps = {}) {
  // Read the route params at the route boundary so this component re-renders
  // (and produces a fresh WalletScreen element) whenever the URL changes.
  // React Compiler memoizes the returned element by its inputs, so passing the
  // params down as props is what propagates post-mount param changes into
  // WalletScreen's render-phase sync. Reading them only inside WalletScreen
  // would let this memoized boundary bail out and swallow the update.
  //
  // `intent` is the per-navigation nonce that distinguishes a genuinely new
  // bank-transfer attempt from a remount of the same one: a remount replays the
  // URL (same nonce), a new tap of the nudge mints a fresh one.
  const { action, intent, requiredAmount, returnTo, savingsAmount, savingsGoalId } =
    useLocalSearchParams<{
      action?: string | string[];
      intent?: string | string[];
      requiredAmount?: string | string[];
      returnTo?: string | string[];
      savingsAmount?: string | string[];
      savingsGoalId?: string | string[];
    }>();

  return (
    <WalletScreen
      action={firstParam(action)}
      intent={firstParam(intent)}
      presentation={presentation}
      requiredAmount={firstParam(requiredAmount)}
      returnTo={firstParam(returnTo)}
      savingsAmount={firstParam(savingsAmount)}
      savingsGoalId={firstParam(savingsGoalId)}
    />
  );
}

function firstParam(value: string | string[] | undefined) {
  // Same 'first value wins' coercion as the funding route's stringParam:
  // a missing or empty param is '' (absent), never an array.
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
