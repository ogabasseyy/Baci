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
  const { action, intent, requiredAmount, returnTo, savingsAmount } =
    useLocalSearchParams<{
      action?: string;
      intent?: string;
      requiredAmount?: string;
      returnTo?: string;
      savingsAmount?: string;
    }>();

  return (
    <WalletScreen
      action={action}
      intent={intent}
      presentation={presentation}
      requiredAmount={requiredAmount}
      returnTo={returnTo}
      savingsAmount={savingsAmount}
    />
  );
}
