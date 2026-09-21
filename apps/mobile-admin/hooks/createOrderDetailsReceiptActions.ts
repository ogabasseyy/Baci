import type { ReceiptMerchant, ReceiptOrder } from '@baci/shared';
import { generateReceiptHtml, sanitizeSvg } from '@baci/shared';
import { Alert } from 'react-native';
import type { OrderDetailsRecord } from '@/components/orders/order-details.types';
import { supabase } from '@/lib/supabase';
import { resolveOrderReceiptVirtualAccount } from './resolveOrderReceiptVirtualAccount';
import { resolveReceiptItemFulfillmentDetails } from './resolveReceiptItemFulfillmentDetails';

let PrintModule: typeof import('expo-print') | null = null;
let SharingModule: typeof import('expo-sharing') | null = null;

async function loadNativeModules() {
  if (PrintModule && SharingModule) {
    return;
  }

  try {
    const [printModule, sharingModule] = await Promise.all([
      import('expo-print'),
      import('expo-sharing'),
    ]);
    PrintModule = printModule;
    SharingModule = sharingModule;
  } catch {
    console.debug('[OrderDetails] Native export modules unavailable');
  }
}

interface ReceiptMerchantDetails {
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_code?: string | null;
  brand_colors?: ReceiptMerchant['brand_colors'];
  business_address?: string | null;
  business_name?: string | null;
  cac_rc_number?: string | null;
  email?: string | null;
  id: string;
  legal_entity_name?: string | null;
  logo_url?: string | null;
  pages?: Record<string, unknown> | null;
  phone?: string | null;
  social_media?: ReceiptMerchant['social_media'];
  support_email?: string | null;
  support_phone?: string | null;
  tax_identification_number?: string | null;
  vat_rate?: number | null;
  vat_registration_status?: string | null;
}

interface CreateOrderDetailsReceiptActionsParams {
  isGeneratingReceipt: boolean;
  merchant: ReceiptMerchantDetails | null | undefined;
  order: OrderDetailsRecord | undefined;
  receiptHtml: string;
  setIsGeneratingReceipt: (value: boolean) => void;
  setReceiptHtml: (value: string) => void;
  setShowReceiptPreview: (value: boolean) => void;
  storeUrl?: string;
}

function resolveMerchantPages(
  pages: Record<string, unknown> | null | undefined
): { terms?: string } | null {
  if (
    pages &&
    typeof pages === 'object' &&
    'terms' in pages &&
    typeof pages.terms === 'string'
  ) {
    return { terms: pages.terms };
  }

  return null;
}

function isSvgLogoUrl(logoUrl: string) {
  try {
    return new URL(logoUrl).pathname.toLowerCase().endsWith('.svg');
  } catch {
    return false;
  }
}

function getOrderReceiptDate(order: OrderDetailsRecord | undefined) {
  const orderDateValue =
    order?.invoice_issue_date ?? order?.transaction_date ?? order?.created_at;
  const orderDate = orderDateValue ? new Date(orderDateValue) : null;
  return orderDate && Number.isFinite(orderDate.getTime())
    ? orderDate
    : new Date();
}

export function createOrderDetailsReceiptActions({
  isGeneratingReceipt,
  merchant,
  order,
  receiptHtml,
  setIsGeneratingReceipt,
  setReceiptHtml,
  setShowReceiptPreview,
  storeUrl,
}: CreateOrderDetailsReceiptActionsParams) {
  const handleSendReceipt = async () => {
    if (!order || !merchant || isGeneratingReceipt) {
      return;
    }

    setIsGeneratingReceipt(true);

    try {
      const virtualAccount = await resolveOrderReceiptVirtualAccount({
        merchant,
        order,
      });
      const receiptOrder: ReceiptOrder = {
        amount_paid: Number(order.amount_paid) || 0,
        balance: Number(order.balance) || 0,
        created_at: order.created_at,
        transaction_date: order.transaction_date ?? null,
        invoice_issue_date: order.invoice_issue_date ?? null,
        currency: order.currency ?? 'NGN',
        customer_email: order.customer_email,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone ?? null,
        discount_amount: Number(order.discount_amount) || 0,
        fulfillment_details: order.fulfillment_details ?? null,
        is_credit_order: order.is_credit_order ?? false,
        items: (order.items ?? []).map((item) => ({
          description: item.details ?? null,
          fulfillment_details: resolveReceiptItemFulfillmentDetails(
            order.fulfillment_details,
            item
          ),
          price: Number(item.price) || 0,
          product_name: item.product_name || item.name || 'Product',
          quantity: item.quantity,
          variant_name: item.variant_name,
        })),
        order_number: order.order_number,
        payment_method: order.payment_method ?? null,
        payment_status: order.payment_status,
        shipping_fee: Number(order.shipping_fee) || 0,
        subtotal: Number(order.subtotal) || Number(order.total) || 0,
        tax_amount: Number(order.tax_amount) || 0,
        total: Number(order.total) || 0,
        virtual_account: virtualAccount,
      };

      let merchantPages = resolveMerchantPages(merchant.pages);
      try {
        const { data, error } = await supabase
          .from('merchants')
          .select('pages')
          .eq('id', merchant.id)
          .maybeSingle();

        if (error) {
          console.warn('[OrderDetails] Merchant pages refresh failed', error);
        } else {
          merchantPages = resolveMerchantPages(data?.pages) ?? merchantPages;
        }
      } catch {
        // Ignore merchant-page refresh failures and fall back to the local merchant payload.
      }

      let logoUrl = merchant.logo_url ?? null;
      let svgXml: string | undefined;

      if (logoUrl?.startsWith('https://')) {
        if (isSvgLogoUrl(logoUrl)) {
          try {
            const response = await fetch(logoUrl);
            if (response.ok) {
              svgXml = sanitizeSvg(await response.text());
            }
          } catch (error) {
            console.warn('[OrderDetails] SVG fetch failed', error);
          }
        } else {
          try {
            const { File, Paths } = await import('expo-file-system');
            const destination = new File(
              Paths.cache,
              `receipt_logo_${Date.now()}.png`
            );
            const downloaded = await File.downloadFileAsync(
              logoUrl,
              destination,
              {
                idempotent: true,
              }
            );
            const base64 = await downloaded.base64();
            logoUrl = `data:${downloaded.type || 'image/png'};base64,${base64}`;
          } catch {
            logoUrl = null;
          }
        }
      }

      const receiptMerchant: ReceiptMerchant = {
        bank_account_number: merchant.bank_account_number ?? null,
        bank_code: merchant.bank_code ?? null,
        brand_colors: merchant.brand_colors ?? undefined,
        business_address: merchant.business_address ?? null,
        business_name: merchant.business_name || 'Baci',
        cac_rc_number: merchant.cac_rc_number ?? null,
        email: merchant.email || '',
        legal_entity_name: merchant.legal_entity_name ?? null,
        logo_url: logoUrl,
        pages: merchantPages,
        phone: merchant.phone ?? null,
        social_media: merchant.social_media ?? null,
        support_email: merchant.support_email ?? null,
        support_phone: merchant.support_phone ?? null,
        tax_identification_number: merchant.tax_identification_number ?? null,
        vat_rate: merchant.vat_rate ?? null,
        vat_registration_status: merchant.vat_registration_status ?? null,
      };

      setReceiptHtml(
        generateReceiptHtml(receiptOrder, receiptMerchant, {
          storeUrl,
          svgXml,
        })
      );
      setShowReceiptPreview(true);
    } catch {
      Alert.alert('Error', 'Failed to generate receipt');
    } finally {
      setIsGeneratingReceipt(false);
    }
  };

  const handleShareReceiptPdf = async () => {
    if (!receiptHtml) {
      return;
    }

    try {
      await loadNativeModules();

      if (!PrintModule || !SharingModule) {
        Alert.alert(
          'Error',
          'Export modules are not available on this platform.'
        );
        return;
      }

      const documentType =
        order?.payment_status === 'paid' ? 'Receipt' : 'Invoice';
      const businessName = (merchant?.business_name || 'Baci').replace(
        /[^a-zA-Z0-9]/g,
        '-'
      );
      const customerName = (order?.customer_name || 'Customer')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .trim()
        .replace(/\s+/g, '-');
      const dateString = getOrderReceiptDate(order)
        .toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: /^\d{4}-\d{2}-\d{2}$/.test(order?.invoice_issue_date ?? '')
            ? 'UTC'
            : 'Africa/Lagos',
        })
        .replace(/ /g, '-');
      const fileName = `${businessName}_${documentType}_${customerName}_${dateString}`;
      const { uri } = await PrintModule.printToFileAsync({ html: receiptHtml });
      const { File } = await import('expo-file-system');
      const sourceFile = new File(uri);
      const directory = uri.substring(0, uri.lastIndexOf('/'));
      const destinationFile = new File(`${directory}/${fileName}.pdf`);

      if (destinationFile.exists) {
        destinationFile.delete();
      }

      await sourceFile.move(destinationFile, { overwrite: true });
      await SharingModule.shareAsync(destinationFile.uri, {
        UTI: '.pdf',
        mimeType: 'application/pdf',
      });
    } catch {
      Alert.alert('Error', 'Failed to share receipt PDF');
    }
  };

  return {
    handleSendReceipt,
    handleShareReceiptPdf,
  };
}
