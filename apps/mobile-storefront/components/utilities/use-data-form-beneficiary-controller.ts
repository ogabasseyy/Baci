import { useState } from 'react';
import type { Biller } from '@/hooks/use-vtu-billers';
import { detectNetwork } from '@/lib/network-utils';
import type { UtilityRepeatRecipient } from '@/lib/utility-repeat';
import {
  nextPhoneDigits,
  sanitizePhoneDigits,
} from './airtime-form-controller.helpers';
import { buildUtilityWalletReturnTo } from './build-utility-wallet-return-to';
import { inferProviderFromDataBillerName } from './data-form.helpers';
import { usePhoneTrimNotice } from './use-phone-trim-notice';

interface UseDataFormBeneficiaryControllerProps {
  initialPhoneNumber?: string;
  initialProvider?: string | null;
  initialPlan?: string | null;
  parsedInitialAmount: number;
  dataPlans?: Biller[];
  recentRecipients?: UtilityRepeatRecipient[];
  onSelectRecentRecipient?: (recipient: UtilityRepeatRecipient) => void;
}

export function useDataFormBeneficiaryController({
  initialPhoneNumber,
  initialProvider,
  initialPlan,
  parsedInitialAmount,
  dataPlans,
  recentRecipients = [],
  onSelectRecentRecipient,
}: UseDataFormBeneficiaryControllerProps) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(
    initialProvider ??
      (initialPhoneNumber
        ? detectNetwork(sanitizePhoneDigits(initialPhoneNumber))
        : null)
  );
  const [isBeneficiarySelected, setIsBeneficiarySelected] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState(
    sanitizePhoneDigits(initialPhoneNumber ?? '')
  );
  const [selectedPlan, setSelectedPlan] = useState<string | null>(
    initialPlan ?? null
  );
  const [selectedDataBiller, setSelectedDataBiller] = useState<Biller | null>(
    null
  );
  const [isDataPickerExpanded, setIsDataPickerExpanded] = useState(
    !initialPlan
  );
  const [planAmount, setPlanAmount] = useState(
    Number.isFinite(parsedInitialAmount) ? parsedInitialAmount : 0
  );

  const syncBillerFromDetectedNetwork = (phoneNum: string) => {
    const detected = detectNetwork(phoneNum);
    if (!detected) return;

    setSelectedProvider(detected);
    if (!dataPlans?.length) return;

    const matchingBiller = dataPlans.find((biller) => {
      const providerName = inferProviderFromDataBillerName(biller.billerName);
      return providerName === detected;
    });

    if (
      matchingBiller &&
      selectedDataBiller?.billerId !== matchingBiller.billerId
    ) {
      setSelectedDataBiller(matchingBiller);
      setIsDataPickerExpanded(false);
      const hasDataPackages = (matchingBiller.billItems?.length ?? 0) > 0;
      setSelectedPlan(hasDataPackages ? null : matchingBiller.billerId);
      setPlanAmount(0);
    }
  };

  const noticeTrim = usePhoneTrimNotice();
  const handlePhoneChange = (text: string) => {
    setIsBeneficiarySelected(false);
    const change = nextPhoneDigits(phoneNumber, text);
    noticeTrim(change);
    const { digits } = change;
    setPhoneNumber(digits);
    syncBillerFromDetectedNetwork(digits);
  };

  const handleSelectRecentRecipient = (recipient: UtilityRepeatRecipient) => {
    // A stored +234 number reads like a typed one (Muse).
    const num = sanitizePhoneDigits(recipient.defaults.phoneNumber ?? '');
    setPhoneNumber(num);
    syncBillerFromDetectedNetwork(num);
    setIsBeneficiarySelected(true);
    if (onSelectRecentRecipient) {
      onSelectRecentRecipient(recipient);
    }
  };

  const activeRecipients = recentRecipients;
  const matchingRecipients = activeRecipients.filter((recipient) => {
    if (!phoneNumber) return true;
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const cleanRecip = (recipient.identifier ?? '').replace(/\D/g, '');
    return (
      cleanRecip.includes(cleanPhone) ||
      recipient.title.toLowerCase().includes(phoneNumber.toLowerCase())
    );
  });

  const shouldShowBeneficiaryList =
    !isBeneficiarySelected &&
    (phoneNumber.length < 5 || matchingRecipients.length > 0);

  const canShowBeneficiaries =
    recentRecipients.length > 0 &&
    Boolean(onSelectRecentRecipient) &&
    shouldShowBeneficiaryList;

  const shouldShowNetworkSection =
    isBeneficiarySelected ||
    (phoneNumber.length >= 5 && matchingRecipients.length === 0);

  // Prefilled deep-link so a wallet top-up round-trips the customer back to a
  // ready-to-buy data form (they still re-tap Buy — never auto-submitted).
  const walletReturnToHref = buildUtilityWalletReturnTo({
    amount: planAmount,
    dataPlanCode: selectedPlan,
    networkProvider: selectedProvider,
    phoneNumber,
    type: 'data',
  });

  return {
    walletReturnToHref,
    phoneNumber,
    setPhoneNumber,
    selectedProvider,
    setSelectedProvider,
    isBeneficiarySelected,
    setIsBeneficiarySelected,
    selectedPlan,
    setSelectedPlan,
    selectedDataBiller,
    setSelectedDataBiller,
    isDataPickerExpanded,
    setIsDataPickerExpanded,
    planAmount,
    setPlanAmount,
    handlePhoneChange,
    handleSelectRecentRecipient,
    matchingRecipients,
    canShowBeneficiaries,
    shouldShowNetworkSection,
    syncBillerFromDetectedNetwork,
  };
}
