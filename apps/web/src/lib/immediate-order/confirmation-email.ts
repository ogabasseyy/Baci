import {
  generateOrderConfirmationEmail,
  generateOrderConfirmationText,
} from '@/lib/email-templates';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/zeptomail';
import {
  getCreditedAmountPaid,
  getImmediateEmailAmountDue,
} from './invoice-credit';
import type {
  ImmediateEmailSendInput,
  ImmediateOrderNotificationContext,
} from './notification-context';

export async function sendImmediateOrderConfirmationEmail(
  ctx: ImmediateOrderNotificationContext,
  artifacts: ImmediateEmailSendInput
): Promise<void> {
  const creditedPaid = getCreditedAmountPaid(
    ctx.order,
    ctx.savingsAmountUsed,
    ctx.walletAmountUsed
  );
  const emailAmountDue = getImmediateEmailAmountDue(
    ctx.orderTotal,
    creditedPaid
  );
  const emailVirtualAccount = artifacts.invoiceVirtualAccount
    ? {
        accountName: artifacts.invoiceVirtualAccount.account_name,
        accountNumber: artifacts.invoiceVirtualAccount.account_number,
        bankName: artifacts.invoiceVirtualAccount.bank_name,
      }
    : undefined;
  const emailBalanceDueInstructions =
    ctx.effectivePaymentMethod === 'invoice' &&
    ctx.immediateEmail.documentKind === 'confirmation' &&
    !ctx.immediateEmail.isPaidForEmail &&
    emailAmountDue > 0;
  const htmlContent = generateOrderConfirmationEmail({
    ...ctx.emailData,
    documentKind: ctx.immediateEmail.documentKind,
    amountDue: emailAmountDue,
    virtualAccount: emailVirtualAccount,
    balanceDueInstructions: emailBalanceDueInstructions,
  });
  const textContent = generateOrderConfirmationText({
    ...ctx.emailData,
    documentKind: ctx.immediateEmail.documentKind,
    amountDue: emailAmountDue,
    virtualAccount: emailVirtualAccount,
    balanceDueInstructions: emailBalanceDueInstructions,
  });
  const emailResult = await sendEmail({
    to: ctx.customerEmail,
    toName: ctx.customerName,
    // Derived from the payment/paid classification (same rule as the
    // body and the Peppol type code, which share isPaidForEmail): the
    // attachment block above may fail, leaving the emailed type code
    // undefined, and the subject must not flip to commercial on that
    // failure.
    subject: ctx.immediateEmail.subject,
    htmlContent,
    textContent,
    replyTo: ctx.replyToEmail,
    emailType: 'orders',
    fromName: ctx.senderName,
    attachments: artifacts.attachments,
    auditContext: {
      merchantId: ctx.merchantId,
      orderId: ctx.order.id,
      customerId: ctx.customerId,
      metadata: {
        trigger: 'order_create_immediate_confirmation',
        paymentMethod: ctx.effectivePaymentMethod,
      },
    },
  });

  if (!emailResult.success) {
    logger.error({
      message: 'Failed to send order confirmation email',
      orderId: ctx.order.id,
      paymentMethod: ctx.effectivePaymentMethod,
      emailError: emailResult.error,
      emailErrorCode: emailResult.errorCode,
      emailErrorDetails: emailResult.errorDetails,
    });
    // Reject so the caller completes the claim as failed (retryable):
    // resolving here would mark the notification sent and permanently
    // suppress the confirmation/proforma email on replay.
    throw new Error('ORDER_CONFIRMATION_EMAIL_FAILED');
  }
  logger.info({
    message: 'Order confirmation email sent',
    orderId: ctx.order.id,
    paymentMethod: ctx.effectivePaymentMethod,
    messageId: emailResult.messageId,
  });
}
