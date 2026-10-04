export interface WalletScreenProps {
  action?: string | string[];
  intent?: string | string[];
  presentation?: 'stack' | 'tab';
  requiredAmount?: string | string[];
  returnTo?: string | string[];
  savingsAmount?: string | string[];
  savingsGoalId?: string | string[];
}

export type WalletScreenPresentation = NonNullable<
  WalletScreenProps['presentation']
>;
