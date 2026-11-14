import { useState } from 'react';

/** Which start-savings sheet is open: review, funding, bank transfer or done. */
export function useStartSavingsSheets() {
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showFundingModal, setShowFundingModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  return {
    setShowFundingModal,
    setShowPreviewModal,
    setShowSuccessModal,
    setShowTransferModal,
    showFundingModal,
    showPreviewModal,
    showSuccessModal,
    showTransferModal,
  };
}
