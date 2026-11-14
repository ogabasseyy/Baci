import { StartSavingsPreviewModal } from './StartSavingsPreviewModal';
import { StartSavingsTransferModal } from './StartSavingsTransferModal';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

type StartSavingsModalsProps = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

export function StartSavingsModals({
  colors,
  controller,
}: StartSavingsModalsProps) {
  return (
    <>
      <StartSavingsPreviewModal colors={colors} controller={controller} />
      <StartSavingsTransferModal colors={colors} controller={controller} />
    </>
  );
}
