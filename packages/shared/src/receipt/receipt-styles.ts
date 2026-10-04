import type { ReceiptStatusConfig } from './receipt-status';

export interface ReceiptStyleParams {
  brandPrimary: string;
  brandLight: string;
  brandCardBorder: string;
  statusConfig: ReceiptStatusConfig;
}

export function getReceiptStyles({
  brandPrimary,
  brandLight,
  brandCardBorder,
  statusConfig,
}: ReceiptStyleParams): string {
  return `
  @page { size: A4; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 210mm; min-height: 297mm; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1f2937;
    background: #fff;
    font-size: 13px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    background: #fff;
    width: 210mm;
    min-height: 297mm;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .accent-bar { height: 4px; flex-shrink: 0; background: ${brandPrimary}; }
  .items-wrapper { position: relative; }
  .watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-28deg);
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 56px;
    font-weight: 900;
    letter-spacing: 5px;
    color: ${statusConfig.watermark};
    border: 4px dashed ${statusConfig.wmBorder};
    border-radius: 10px;
    padding: 6px 22px;
    pointer-events: none;
    white-space: nowrap;
    z-index: 0;
    user-select: none;
  }

  .content { padding: 24px 28px 20px; position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
  .logo-img { max-height: 48px; max-width: 140px; object-fit: contain; display: block; }
  .logo-svg svg { max-height: 48px; max-width: 140px; width: auto; height: auto; display: block; }
  .logo-fallback { font-family: Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 800; color: #111827; letter-spacing: -0.5px; }
  .merchant-contact { margin-top: 6px; font-size: 12px; color: #6b7280; line-height: 1.5; }
  .merchant-contact strong { color: #374151; font-weight: 600; }
  .doc-meta { text-align: right; }
  .doc-title { font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 800; color: #111827; text-transform: uppercase; letter-spacing: 1px; }
  .doc-number { font-size: 13px; font-weight: 600; color: #6b7280; margin-top: 3px; }
  .doc-date { font-size: 12px; color: #9ca3af; margin-top: 2px; }
  .status-badge {
    display: inline-block;
    margin-top: 6px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    border-radius: 4px;
    color: ${statusConfig.color};
    background: ${statusConfig.bg};
    border: 1px solid ${statusConfig.border};
  }

  .info-grid { display: flex; gap: 24px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid ${brandCardBorder}; }
  .info-col { flex: 1; }
  .info-col-right { text-align: right; }
  .info-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: ${brandPrimary}; margin-bottom: 4px; }
  .info-name { font-size: 15px; font-weight: 700; color: #111827; margin-bottom: 2px; }
  .info-detail { font-size: 12px; color: #6b7280; line-height: 1.5; }

  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .items-table thead th {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #6b7280;
    padding: 8px 6px;
    border-bottom: 2px solid ${brandPrimary};
    background: ${brandLight};
  }
  .items-table thead th:first-child { padding-left: 10px; border-radius: 4px 0 0 0; }
  .items-table thead th:last-child { border-radius: 0 4px 0 0; }
  .items-table tbody td {
    padding: 10px 6px;
    font-size: 13px;
    color: #374151;
    border-bottom: 1px solid #f8fafc;
    vertical-align: top;
  }
  .items-table tbody tr.zebra td { background: #fafbfc; }
  .cell-num { width: 28px; color: #9ca3af; text-align: center; }
  .cell-item { font-weight: 600; color: #111827; word-break: break-word; }
  .cell-item-description { margin-top: 3px; font-size: 11px; line-height: 1.4; font-weight: 500; color: #6b7280; }
  .cell-line-meta { margin-top: 3px; font-size: 11px; line-height: 1.4; font-weight: 500; color: #6b7280; }
  .cell-qty { text-align: center; white-space: nowrap; padding-right: 12px; }
  .cell-price { text-align: right; white-space: nowrap; font-family: 'SF Mono', Menlo, Monaco, monospace; font-size: 12px; padding-right: 12px; }
  .cell-total { text-align: right; white-space: nowrap; font-family: 'SF Mono', Menlo, Monaco, monospace; font-size: 12px; font-weight: 700; color: #111827; }

  .summary { display: flex; justify-content: flex-end; margin-bottom: 18px; }
  .summary-inner { width: 240px; }
  .sum-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; color: #4b5563; }
  .sum-row span:last-child { font-family: 'SF Mono', Menlo, Monaco, monospace; font-size: 13px; }
  .sum-divider { border-top: 2px solid ${brandPrimary}; margin: 6px 0; }
  .sum-total { font-size: 15px; font-weight: 800; color: #111827; padding: 3px 0; }
  .sum-total span:last-child { font-family: 'SF Mono', Menlo, Monaco, monospace; font-size: 15px; }
  .sum-paid { padding-top: 8px; }
  .sum-due { font-size: 14px; font-weight: 700; padding-top: 2px; }

  .section-block { margin-bottom: 16px; }
  .section-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: #1a1a2e; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  .cell-fulfillment-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
  .fulfillment-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .fulfillment-item { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; padding: 7px 10px; }
  .fulfillment-key { font-size: 9px; font-weight: 800; color: ${brandPrimary}; text-transform: uppercase; letter-spacing: 0.6px; }
  .fulfillment-val { font-family: 'SF Mono', Menlo, Monaco, monospace; font-size: 11px; font-weight: 700; color: #111827; }

  .tx-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .tx-table th { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9ca3af; padding: 6px 8px; text-align: left; border-bottom: 1px solid #e5e7eb; }
  .tx-table td { padding: 8px; color: #374151; border-bottom: 1px solid #f3f4f6; }

  .bank-grid { display: flex; gap: 16px; }
  .bank-card { flex: 1; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
  .bank-label { font-size: 10px; font-weight: 700; color: #1a1a2e; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .bank-row { display: flex; justify-content: space-between; padding: 3px 0; }
  .bank-key { font-size: 10px; color: #9ca3af; }
  .bank-val { font-size: 11px; font-weight: 600; color: #111827; }
  .bank-acct { font-family: 'SF Mono', Menlo, Monaco, monospace; font-size: 13px; font-weight: 800; letter-spacing: 0.5px; }
  .bank-hint { font-size: 9px; color: #6b7280; margin-bottom: 8px; font-style: italic; }
  .bank-contact { display: flex; align-items: center; flex-wrap: wrap; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e5e7eb; }

  .qr-block { text-align: center; margin: 14px 0; }
  .qr-block img { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px; background: #fff; }
  .qr-caption { font-size: 10px; color: #9ca3af; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }

  .footer-area { margin-top: auto; padding-top: 14px; text-align: center; }
  .footer-row { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px; font-size: 11px; color: #6b7280; margin-bottom: 6px; }
  .footer-row a { color: ${brandPrimary}; text-decoration: none; font-weight: 600; }
  .footer-item { display: inline-flex; align-items: center; gap: 3px; }
  .footer-icon { display: inline-flex; align-items: center; }
  .footer-email-icon { display: inline-flex; align-items: center; color: ${brandPrimary}; }
  .footer-sep { color: #d1d5db; margin: 0 2px; }
  .terms { font-size: 10px; color: #6b7280; margin-bottom: 6px; }
  .terms a { color: ${brandPrimary}; text-decoration: none; font-weight: 600; }
  .terms-block { margin: 10px 0 8px; padding: 10px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; text-align: left; }
  .terms-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #374151; margin-bottom: 4px; }
  .terms-text { font-size: 9px; color: #6b7280; line-height: 1.5; }
  .terms-link { font-size: 9px; margin-top: 4px; }
  .terms-link a { color: ${brandPrimary}; text-decoration: none; font-weight: 600; }
  .powered { font-size: 11px; color: ${brandPrimary}; font-weight: 600; text-transform: uppercase; letter-spacing: 2px; margin-top: 14px; padding-top: 10px; border-top: 1px solid ${brandCardBorder}; }
`;
}
