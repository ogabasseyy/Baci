import { StartSavingsFundingContent } from './StartSavingsFundingContent';
import { StartSavingsPreviewModal } from './StartSavingsPreviewModal';
import { StartSavingsSuccessModal } from './StartSavingsSuccessModal';
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
      <StartSavingsPreviewModal
        colors={colors}
        controller={controller}
        fundingContent={
          <StartSavingsFundingContent colors={colors} controller={controller} />
        }
      />
      <StartSavingsTransferModal colors={colors} controller={controller} />
      <StartSavingsSuccessModal colors={colors} controller={controller} />
    </>
  );
}
