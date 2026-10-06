import { LegacyStartSavingsScreen } from './LegacyStartSavingsScreen';
import { PiggyvestSavingsScreen } from './PiggyvestSavingsScreen';
import type { PiggyvestSavingsScreenInput } from './PiggyvestSavingsScreen.types';

export function StartSavingsScreen(
  props: { staging?: PiggyvestSavingsScreenInput | null } = {}
) {
  return Object.hasOwn(props, 'staging') ? (
    <PiggyvestSavingsScreen staging={props.staging ?? null} />
  ) : (
    <LegacyStartSavingsScreen />
  );
}
