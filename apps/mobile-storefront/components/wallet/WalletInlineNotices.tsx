import type Colors from '@/constants/Colors';
import { WalletFundPromptCard } from './fund/WalletFundPromptCard';
import { SavingsNoticeCard } from './savings/SavingsNoticeCard';

const INSET = { marginHorizontal: 16, marginTop: 12 };

/**
 * The wallet's inline notice and any funding question left open, under the
 * hero, inset like the wallet's cards. Hidden while the savings sheet is
 * open (it shows its own); the question also hides while Add money is open
 * (the sheet shows it). Both draw nothing unless something is waiting, and
 * only the PiggyVest merchant's flows ever put something there.
 */
export function WalletInlineNotices({
  colors,
  goalId,
  savingsSheetOpen,
  fundSheetOpen,
}: {
  colors: (typeof Colors)['light'];
  goalId?: string | null;
  savingsSheetOpen: boolean;
  fundSheetOpen: boolean;
}) {
  if (savingsSheetOpen) return null;
  return (
    <>
      <SavingsNoticeCard colors={colors} goalId={goalId} style={INSET} />
      {fundSheetOpen ? null : (
        <WalletFundPromptCard colors={colors} style={INSET} />
      )}
    </>
  );
}
