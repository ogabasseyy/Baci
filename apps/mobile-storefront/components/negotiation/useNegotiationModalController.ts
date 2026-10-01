import {
  buildCartSnapshot,
  MAX_AUTO_NEGOTIATION_DISCOUNT_RATE,
  summarizeCartForItemInfo,
} from '@baci/shared/lib';
import type { ImpactFeedbackStyle } from 'expo-haptics';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { NegotiationStatus } from './NegotiationModalView';
import { NEGOTIATION_CHEAPER_BUTTON_THRESHOLD } from './negotiation.constants';
import { getNegotiationCustomerContact } from './negotiation-customer-auth';
import type { NegotiationCustomerContact } from './negotiation-customer-contact';
import {
  createNegotiationSessionId,
  uploadNegotiationEvidence,
} from './negotiation-evidence';
import {
  ensureNegotiationNativeModules,
  getNegotiationHapticsModule,
  getNegotiationImagePickerModule,
} from './negotiation-native-modules';
import {
  buildNegotiationRequestItemInfo,
  computeCounterOffer,
  toNegotiationCartLine,
} from './negotiation-offer-helpers';
import type { UseNegotiationModalControllerParams } from './useNegotiationModalController.types';

const log = createLogger('NegotiationModal');
void ensureNegotiationNativeModules();

export function useNegotiationModalController({
  currentPrice,
  isNegotiable = true,
  itemInfo,
  merchantId,
  onAcceptedPrice,
  successMessageFormatter,
  type,
  visible,
  cartItems,
  prefillPhone,
}: UseNegotiationModalControllerParams) {
  const [offer, setOffer] = useState('');
  const [status, setStatus] = useState<NegotiationStatus>('input');
  const [message, setMessage] = useState('');
  const [attemptCount, setAttemptCount] = useState(0);
  const [counterOffer, setCounterOffer] = useState<number | null>(null);
  const [uploadFile, setUploadFile] = useState<string | null>(null);
  const [uploadLink, setUploadLink] = useState('');
  const [phone, setPhone] = useState(prefillPhone ?? '');

  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setOffer('');
      setMessage('');
      setAttemptCount(0);
      setCounterOffer(null);
      setUploadFile(null);
      setUploadLink('');
      setPhone(prefillPhone ?? '');
      if (isNegotiable === false) {
        setStatus('final');
        setMessage('This is already the best price.');
      } else {
        setStatus('input');
      }
    }
  }

  const triggerHaptic = (style?: ImpactFeedbackStyle) => {
    const hapticsModule = getNegotiationHapticsModule();
    if (Platform.OS !== 'ios' || !hapticsModule) {
      return;
    }

    hapticsModule
      .impactAsync(style ?? hapticsModule.ImpactFeedbackStyle.Light)
      .catch(() => {
        // Haptics are best-effort; ignore failures (e.g. unsupported device).
      });
  };

  const handleSubmitOffer = (offerAmount: number) => {
    setStatus('processing');
    triggerHaptic(getNegotiationHapticsModule()?.ImpactFeedbackStyle?.Medium);

    setTimeout(() => {
      const discountPercentage = 1 - offerAmount / currentPrice;

      if (isNegotiable === false) {
        setStatus('final');
        setMessage('This is already the best price.');
        return;
      }

      if (discountPercentage <= MAX_AUTO_NEGOTIATION_DISCOUNT_RATE) {
        setStatus('success');
        setOffer(offerAmount.toString());
        setMessage(successMessageFormatter(offerAmount));
        triggerHaptic(
          getNegotiationHapticsModule()?.ImpactFeedbackStyle?.Heavy
        );
        onAcceptedPrice?.(offerAmount);
        return;
      }

      const { proposedCounter, replyMessage } = computeCounterOffer(
        attemptCount,
        currentPrice
      );

      if (attemptCount >= NEGOTIATION_CHEAPER_BUTTON_THRESHOLD) {
        setStatus('upload');
        setMessage(
          "You're looking for a serious discount! Upload evidence of a lower price elsewhere and a merchant will review your request."
        );
        return;
      }

      setStatus('failed');
      setCounterOffer(proposedCounter);
      setMessage(replyMessage);
      setAttemptCount((previous) => previous + 1);
      triggerHaptic(getNegotiationHapticsModule()?.ImpactFeedbackStyle?.Medium);
    }, 1500);
  };

  const handleAcceptCounter = () => {
    if (!counterOffer) {
      return;
    }

    setStatus('success');
    setOffer(counterOffer.toString());
    setMessage(successMessageFormatter(counterOffer));
    triggerHaptic(getNegotiationHapticsModule()?.ImpactFeedbackStyle?.Heavy);
    onAcceptedPrice?.(counterOffer);
  };

  const submitMerchantRequest = async (
    evidenceUrl: string | undefined,
    customerContact: NegotiationCustomerContact
  ) => {
    if (!merchantId) {
      Alert.alert('Error', 'Unable to identify merchant. Please try again.');
      return;
    }

    setStatus('processing');
    const offerAmount =
      Number.parseFloat(offer.replace(/[^0-9.]/g, '')) || currentPrice * 0.9;

    const handleSubmitFailure = (
      error: unknown,
      message = 'Failed to submit request. Please try again.'
    ) => {
      log.error('Failed to submit request:', error);
      Alert.alert('Error', message);
      setStatus('upload');
    };

    try {
      const cartSnapshot =
        type === 'total' && cartItems
          ? buildCartSnapshot(cartItems.map(toNegotiationCartLine))
          : [];
      if (type === 'total' && cartSnapshot.length === 0) {
        handleSubmitFailure(
          new Error('Missing cart snapshot'),
          'Whole-cart negotiations require at least one cart item.'
        );
        return;
      }
      const totalItemInfo =
        type === 'total'
          ? summarizeCartForItemInfo(cartSnapshot, currentPrice)
          : null;

      const { error } = await supabase.from('negotiation_requests').insert({
        merchant_id: merchantId,
        session_id: createNegotiationSessionId(),
        customer_id: customerContact.userId,
        customer_email: customerContact.normalizedEmail,
        type,
        item_info: buildNegotiationRequestItemInfo({
          itemInfo,
          totalItemInfo,
          type,
        }),
        cart_snapshot: cartSnapshot.length > 0 ? cartSnapshot : null,
        offered_price: offerAmount,
        evidence_url: evidenceUrl || null,
        customer_phone: customerContact.normalizedPhone,
        status: 'pending',
      });

      if (error) {
        handleSubmitFailure(error);
        return;
      }

      setStatus('submitted');
      setMessage(
        "Request submitted! We'll notify you as soon as the merchant reviews your offer."
      );
      triggerHaptic(getNegotiationHapticsModule()?.ImpactFeedbackStyle?.Heavy);
    } catch (error) {
      handleSubmitFailure(error);
    }
  };

  const handleUploadSubmit = async () => {
    const normalizedLink = uploadLink.trim();
    if (!uploadFile && !normalizedLink) {
      Alert.alert('Evidence Required', 'Please add a photo or link as proof.');
      return;
    }

    try {
      if (!merchantId) {
        Alert.alert('Error', 'Unable to identify merchant. Please try again.');
        return;
      }
      const customerContact = await getNegotiationCustomerContact(phone);
      if (customerContact.errorMessage) {
        setStatus('upload');
        Alert.alert('Error', customerContact.errorMessage);
        return;
      }

      let evidenceUrl = normalizedLink;
      if (!evidenceUrl && uploadFile) {
        evidenceUrl = await uploadNegotiationEvidence(uploadFile, merchantId);
      }
      await submitMerchantRequest(evidenceUrl || undefined, customerContact);
    } catch (error) {
      log.error('Failed to upload negotiation evidence:', error);
      Alert.alert(
        'Upload failed',
        'Unable to upload evidence image. Please try again or use a link.'
      );
      setStatus('upload');
    }
  };

  const pickImage = async () => {
    await ensureNegotiationNativeModules();

    const imagePickerModule = getNegotiationImagePickerModule();
    if (!imagePickerModule) {
      Alert.alert(
        'Not Supported',
        'Image picking is not supported on this platform.'
      );
      return;
    }

    const result = await imagePickerModule.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setUploadFile(result.assets[0].uri);
      triggerHaptic();
    }
  };

  return {
    attemptCount,
    backFromUpload: () => setStatus('failed'),
    counterOffer,
    handleAcceptCounter,
    handleSubmitOffer,
    handleUploadSubmit,
    message,
    offer,
    openUpload: () => setStatus('upload'),
    phone,
    pickImage,
    resetToInput: () => setStatus('input'),
    setOffer,
    setPhone,
    setUploadLink,
    status,
    uploadFile,
    uploadLink,
  };
}
