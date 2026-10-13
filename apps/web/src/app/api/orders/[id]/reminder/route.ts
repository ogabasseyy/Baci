import { selectPreferredOrderPaymentAccount } from '@baci/shared';
import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
} from '@/lib/api-auth';
import { buildOrderTrackingLink } from '@/lib/build-order-tracking-link';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  generatePaymentReminderEmail,
  generatePaymentReminderText,
} from '@/lib/email-templates';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/zeptomail';
import { orderReminderSchema } from '@/schemas/order-reminder';

/**
 * POST /api/orders/[id]/reminder
 * Send payment reminder to customer via email, SMS, or WhatsApp.
 * Includes payment link and virtual account details if available.
 * Supports both cookie-based auth (web) and Bearer token auth (mobile).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const { id: orderId } = await params;

    // 1. Authenticate request (supports mobile Bearer token + web cookies)
    const auth = await authenticateApiRequest(request);
    if (auth.error) {
      logger.warn({ message: 'Reminder API: Auth failed', error: auth.error });
    }
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Get merchant ID (supports both owners and staff members)
    const merchantId = await getMerchantIdForApiUser(auth.supabase);
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const supabase = auth.supabase;

    // Parse body after auth to avoid processing unauthenticated requests
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = orderReminderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // 3. Get merchant details for email
    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select(
        'id, business_name, slug, support_email, email_sender_name, tax_identification_number, cac_rc_number'
      )
      .eq('id', merchantId)
      .single();

    if (merchantError || !merchant) {
      logger.error({
        message: 'Merchant details fetch failed',
        merchantId,
        error: merchantError,
      });
      return NextResponse.json(
        { error: 'Merchant details not found' },
        { status: 404 }
      );
    }

    // 3. Get order with items
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(
        'id, order_number, total, amount_paid, customer_id, customer_name, customer_email, customer_phone, payment_status, currency, tracking_token'
      )
      .eq('id', orderId)
      .eq('merchant_id', merchant.id)
      .single();

    if (!order) {
      if (orderError && orderError.code !== 'PGRST116') {
        logger.warn({
          message: 'Reminder API: Order lookup failed',
          orderId,
          error: orderError,
        });
      }
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // 4. Get order items for email
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('product_name, quantity, price')
      .eq('order_id', orderId);

    // 5. Get virtual account if exists
    const { data: paymentAccounts } = await supabase
      .from('order_payment_accounts')
      .select(
        'account_number, bank_name, account_name, provider, assignment_customer_email_source, created_at, assigned_at, expires_at'
      )
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });
    const virtualAccount = selectPreferredOrderPaymentAccount(paymentAccounts);

    // 6. Generate payment link: the emailed CTA must resolve to a served
    // page. Prefer the tracking-token form — the only variant that needs no
    // customer email — so the URL never carries PII; /track-order also
    // auto-resolves the order id plus email fallback pair. There is no
    // /checkout/resume route — linking it shipped a 404.
    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
    const merchantUrl = `https://${merchant.slug}.${rootDomain}`;
    const paymentLink = buildOrderTrackingLink(
      merchantUrl,
      { id: orderId, tracking_token: order.tracking_token },
      order.customer_email
    );

    // 7. Determine channel (email by default)
    const channel = parsed.data.channel || 'email';

    // 8. Calculate balance
    const balanceDue = Number(order.total) - Number(order.amount_paid || 0);

    // 9. Prepare email data
    const emailData = {
      orderNumber: order.order_number,
      customerName: order.customer_name,
      items: (orderItems || []).map((item) => ({
        name: item.product_name,
        quantity: item.quantity,
        price: item.price,
      })),
      totalAmount: Number(order.total),
      amountPaid: Number(order.amount_paid || 0),
      balanceDue,
      paymentLink,
      merchantName: merchant.business_name,
      merchantUrl,
      currency: order.currency || 'NGN',
      supportEmail: merchant.support_email || undefined,
      merchantTin: merchant.tax_identification_number ?? undefined,
      merchantRcNumber: merchant.cac_rc_number ?? undefined,
      virtualAccount: virtualAccount
        ? {
            bankName: virtualAccount.bank_name,
            accountNumber: virtualAccount.account_number,
            accountName: virtualAccount.account_name,
          }
        : null,
    };

    // 10. Send based on channel
    let sendResult: { success: boolean; error: string };

    if (channel === 'email' && order.customer_email) {
      try {
        await sendEmail({
          to: order.customer_email,
          toName: order.customer_name,
          subject: `Payment Reminder - Order #${order.order_number}`,
          textContent: generatePaymentReminderText(emailData),
          htmlContent: generatePaymentReminderEmail(emailData),
          replyTo: merchant.support_email || undefined,
          emailType: 'orders',
          fromName: merchant.email_sender_name || merchant.business_name,
          auditContext: {
            merchantId,
            orderId: order.id,
            customerId: order.customer_id,
            metadata: {
              trigger: 'payment_reminder',
              channel,
            },
          },
        });
        sendResult = { success: true, error: '' };
      } catch (err) {
        logger.error({ message: 'Failed to send reminder email', error: err });
        sendResult = { success: false, error: 'Email sending failed' };
      }
    } else if (channel === 'whatsapp' && order.customer_phone) {
      // TODO: Integrate WhatsApp API (Twilio, Meta, etc.)
      sendResult = {
        success: false,
        error: 'WhatsApp channel not yet implemented',
      };
    } else if (channel === 'sms' && order.customer_phone) {
      // TODO: Integrate SMS API (Twilio, Termii, etc.)
      sendResult = { success: false, error: 'SMS channel not yet implemented' };
    } else {
      return NextResponse.json(
        { error: `No valid contact for channel: ${channel}` },
        { status: 400 }
      );
    }

    // 10. Log reminder
    if (sendResult.success) {
      const { error: insertError } = await supabase
        .from('order_reminders')
        .insert({
          order_id: orderId,
          channel,
          payment_link: paymentLink,
        });
      if (insertError) {
        logger.warn({
          message: 'Failed to log reminder',
          orderId,
          error: insertError,
        });
      }
    }

    return NextResponse.json({
      success: sendResult.success,
      message: sendResult.success
        ? 'Reminder sent successfully'
        : sendResult.error,
      channel,
      paymentLink,
      virtualAccount: virtualAccount || null,
    });
  } catch (error) {
    logger.error({ message: 'Reminder API error', error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
