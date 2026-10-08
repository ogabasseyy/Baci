import { PlanTransferMode } from './PlanTransferMode';
import type { TransferModalProps } from './start-savings-transfer-modal-props';
import { WalletTransferMode } from './WalletTransferMode';

export function StartSavingsTransferModal({
  colors,
  controller,
}: TransferModalProps) {
  if (controller.createdGoalId) {
    return <PlanTransferMode colors={colors} controller={controller} />;
  }
  return <WalletTransferMode colors={colors} controller={controller} />;
}
