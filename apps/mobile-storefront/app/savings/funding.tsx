import { Redirect } from 'expo-router';

/**
 * Savings plans have no bank account of their own in the app: they are
 * funded from the PiggyVest wallet only. Old links to this screen land on
 * the wallet instead of showing a plan account number.
 */
export default function SavingsPlanFundingRoute() {
  return <Redirect href="/wallet" />;
}
