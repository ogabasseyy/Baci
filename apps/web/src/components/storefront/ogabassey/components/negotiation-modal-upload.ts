import type { CartItem } from '@/hooks/cart';
import type { createClient } from '@/lib/supabase/client';
import { uploadNegotiationEvidenceFile } from './negotiation-evidence';
import { resolveNegotiationCustomer } from './negotiation-modal-customer';
import { insertNegotiationRequest } from './negotiation-modal-request';
import type { NegotiationStatus } from './use-negotiation-modal-controller';
import { getContactValidationError } from './negotiation-contact-validation';
import { getUploadFormValidationError } from './negotiation-upload-validation';
import { NegotiationValidationError } from './negotiation-validation-error';

interface SubmitNegotiationUploadOptions {
  canApplyAsyncResult: () => boolean;
  cart?: CartItem[];
  condition?: string;
  currentPrice: number;
  email: string;
  itemId?: string;
  merchantId: string;
  offer: string;
  phone: string;
  productBrand?: string;
  productName: string;
  productSlug?: string;
  setMessage: (message: string) => void;
  setStatus: (status: NegotiationStatus) => void;
  supabase: ReturnType<typeof createClient>;
  type: 'single' | 'total';
  uploadFile: File | null;
  uploadLink: string;
  variantAttributes?: Record<string, string>;
  variantId?: string;
  variantName?: string;
}

const uploadedEvidenceByFile = new WeakMap<
  File,
  { evidencePath: string; merchantId: string }
>();

export async function submitNegotiationUpload({
  canApplyAsyncResult,
  cart,
  condition,
  currentPrice,
  email,
  itemId,
  merchantId,
  offer,
  phone,
  productBrand,
  productName,
  productSlug,
  setMessage,
  setStatus,
  supabase,
  type,
  uploadFile,
  uploadLink,
  variantAttributes,
  variantId,
  variantName,
}: SubmitNegotiationUploadOptions): Promise<void> {
  // Client-independent checks first (shared with the submit handler, which
  // runs them before the Supabase client chunk even downloads).
  const formError = getUploadFormValidationError({
    currentPrice,
    merchantId,
    offer,
    uploadFile,
    uploadLink,
  });
  if (formError) {
    alert(formError);
    return;
  }
  const trimmedLink = uploadLink.trim();
  const offeredPrice = Number(offer.trim());

  let customer: Awaited<ReturnType<typeof resolveNegotiationCustomer>>;
  try {
    customer = await resolveNegotiationCustomer(supabase);
  } catch (error) {
    console.error('Failed to verify negotiation customer:', error);
    alert('Unable to verify your account. Please try again.');
    return;
  }
  const contactError = getContactValidationError({
    allowMissingContact: Boolean(
      customer.customerEmail || customer.customerPhone
    ),
    email,
    phone,
  });
  if (contactError) {
    alert(contactError);
    return;
  }
  const customerEmail = email.trim().toLowerCase() || customer.customerEmail;
  const customerPhone = phone.trim() || customer.customerPhone;

  const submitMerchantRequest = async (
    evidenceUrl: string | undefined
  ): Promise<boolean> => {
    setStatus('processing');
    try {
      await insertNegotiationRequest(supabase, {
        cart,
        condition,
        currentPrice,
        customerEmail,
        customerId: customer.customerId,
        customerPhone,
        evidenceUrl,
        itemId,
        merchantId,
        offeredPrice,
        productBrand,
        productName,
        productSlug,
        type,
        variantAttributes,
        variantId,
        variantName,
      });
      if (!canApplyAsyncResult()) return true;
      setStatus('submitted');
      setMessage(
        "Request submitted! We'll notify you as soon as the merchant reviews your offer."
      );
      return true;
    } catch (error) {
      console.error('Failed to submit request:', error);
      if (!canApplyAsyncResult()) return false;
      alert(
        error instanceof NegotiationValidationError
          ? error.message
          : 'Failed to submit request. Please try again.'
      );
      setStatus('upload');
      return false;
    }
  };

  if (trimmedLink) {
    await submitMerchantRequest(trimmedLink);
    return;
  }
  if (!uploadFile) {
    alert('Upload proof or paste a link before sending your request.');
    return;
  }

  setStatus('processing');
  try {
    const cachedEvidence = uploadedEvidenceByFile.get(uploadFile);
    const evidencePath =
      cachedEvidence?.merchantId === merchantId
        ? cachedEvidence.evidencePath
        : await uploadNegotiationEvidenceFile({
            file: uploadFile,
            merchantId,
          });
    uploadedEvidenceByFile.set(uploadFile, { evidencePath, merchantId });
    const submitted = await submitMerchantRequest(evidencePath);
    if (submitted) {
      uploadedEvidenceByFile.delete(uploadFile);
    }
  } catch (error) {
    console.error('Failed to upload evidence:', error);
    if (!canApplyAsyncResult()) return;
    alert(
      error instanceof Error
        ? error.message
        : 'Unable to upload evidence image. Please try again.'
    );
    setStatus('upload');
  }
}
