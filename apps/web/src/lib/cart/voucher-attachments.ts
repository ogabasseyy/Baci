import { verifyQuizVoucherToken } from '@/lib/quiz-voucher-token';

interface VoucherAttachmentLine {
  item: {
    productId: string;
    variantId?: string;
    condition?: string;
  };
  voucherAwardId?: string;
  voucherToken?: string;
}

/**
 * A complete voucher pair zero-prices its line in every snapshot, so
 * the pair is verified when first stored: the token must be a validly
 * signed quiz voucher bound to the same award, product, variant, and
 * condition as the line. Award status and owner are re-verified at
 * order creation; an unverifiable pair is rejected here instead of
 * silently pricing the line at zero.
 */
export function voucherAttachmentsValid(
  lines: readonly VoucherAttachmentLine[]
): boolean {
  for (const line of lines) {
    if (!line.voucherToken && !line.voucherAwardId) continue;
    if (!line.voucherToken || !line.voucherAwardId) return false;
    const verification = verifyQuizVoucherToken(line.voucherToken);
    if (!verification.ok) return false;
    const payload = verification.payload;
    if (payload.awardId !== line.voucherAwardId) return false;
    if (payload.productId !== line.item.productId) return false;
    if (payload.variantId !== (line.item.variantId ?? null)) return false;
    if (payload.condition !== (line.item.condition ?? null)) return false;
  }
  return true;
}

/** Lines carrying voucher attachments from a parsed cart command. */
export function commandVoucherLines(command: {
  type: string;
  item?: VoucherAttachmentLine['item'];
  lines?: readonly VoucherAttachmentLine[];
  voucherAwardId?: string;
  voucherToken?: string;
}): VoucherAttachmentLine[] {
  if (command.type === 'replace') return [...(command.lines ?? [])];
  if (command.type === 'add' && command.item)
    return [
      {
        item: command.item,
        voucherAwardId: command.voucherAwardId,
        voucherToken: command.voucherToken,
      },
    ];
  return [];
}
