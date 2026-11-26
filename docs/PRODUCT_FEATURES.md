# Baci Product Capabilities & Feature Catalog

> **Single Source of Truth for Agents & Marketing**
> Merchant-facing features in Baci span **four places**: `apps/web/src/app/dashboard/`, `apps/web/src/app/api/`, `apps/mobile-admin/app/(admin)/`, and `apps/mobile-storefront/app/`. Do **not** infer product capabilities from `apps/web/src/app/dashboard/` alone.
>
> Public marketing surfaces (`usebaci.com`, `/features`, `/features.md`) render from [`apps/web/src/config/platform-features.ts`](../apps/web/src/config/platform-features.ts). Keep this file and `platform-features.ts` updated together when shipping or retiring merchant features.

---

## 1. General Platform Capabilities (Verified Live)

### Sell & Convert
- **Price Negotiations ("Haggling")** (`Storefront`, `Mobile Admin`, `API`)
  - Single-item and whole-cart offers with up to 3 automated counter-offer rounds bounded by cost-margin floors and a 2% auto-negotiation cap, plus competitor screenshot/link evidence upload and real-time merchant accept/reject queue.
  - Code: `apps/web/src/app/api/storefront/negotiate/route.ts`, `apps/web/src/app/api/negotiations/resolve/route.ts`, `apps/mobile-admin/app/(admin)/negotiations.tsx`, `packages/shared/src/lib/negotiation-policy.ts`
- **Discount Codes & Promo Vouchers** (`Web`, `Mobile Admin`, `Storefront`, `API`)
  - Percentage/fixed-amount codes with min spend, max discount cap, total/per-customer usage limits, schedules, and product/category targeting.
  - Code: `apps/web/src/app/dashboard/marketing/discount-codes/discount-client.tsx`, `apps/mobile-admin/app/(admin)/discounts/`, `apps/web/src/app/api/discount-codes/`
- **Announcement Bar Configurator** (`Web`, `Storefront`)
  - Live-preview storefront announcement bar with custom copy, CTA link, and colors.
  - Code: `apps/web/src/app/dashboard/marketing/announcement-bar/page.tsx`
- **Tiered Loyalty Program** (`Web`, `Storefront`, `API`)
  - Bronze-to-Diamond tiers, earn rules (spend, signup, birthday, review, referral), redemption limits, and points-to-airtime option.
  - Code: `apps/web/src/app/dashboard/loyalty/page.tsx`, `apps/web/src/app/api/loyalty/`, `apps/web/src/components/storefront/loyalty/`
- **Smart Cart, Gifting, Comparison & Live Repricing** (`Storefront`, `Mobile Storefront`)
  - Live catalog price-drift checks, cart item gifting (`GiftModal`), 3-product side-by-side comparison, quick-view, sticky add-to-cart, recently viewed, and upsell toasts.
  - Code: `apps/web/src/app/api/cart/validate/route.ts`, `apps/mobile-storefront/services/cart-reprice.ts`, `apps/web/src/components/storefront/`
- **Abandoned Checkout / Failed Payment Follow-Up Queue** (`Mobile Admin`)
  - Badged queue of failed, expired, unpaid, BNPL drop-off, and abandoned transfer orders with gateway error details and 1-tap WhatsApp/call outreach.
  - Code: `apps/mobile-admin/components/customers/FollowUpQueueList.tsx`
- **Verified Product Reviews, Google Reviews, Wishlists & Social Proof** (`Web`, `Storefront`, `API`)
  - Review moderation + merchant replies, Google Places 5-review sync, customer wishlists, and daily/weekly purchase social proof stats.
  - Code: `apps/web/src/app/dashboard/reviews/page.tsx`, `apps/web/src/app/api/reviews/`, `apps/web/src/app/api/wishlist/`, `apps/web/src/app/api/storefront/social-proof/route.ts`

### Payments & Fintech
- **Multi-Gateway Checkout & Weekly Auto-Payouts** (`Web`, `Storefront`, `Mobile Admin`, `API`)
  - Paystack, Korapay, Bank Transfer (DVA), Pay on Delivery, webhook reconciliation, merchant wallet ledger, and weekly auto-payout scheduling.
  - Code: `apps/web/src/app/api/payments/`, `apps/web/src/app/dashboard/wallet/wallet-client.tsx`, `apps/web/src/app/dashboard/settings/payments/`
- **Buy Now, Pay Later (BNPL)** (`Storefront`, `Mobile Storefront`, `Mobile Admin`, `API`)
  - CredPal, Credit Direct (server-signed), and Klump installment checkout with WebView handoff.
  - Code: `apps/web/src/app/api/payments/credit-direct/`, `apps/web/src/app/api/payments/klump/`, `apps/mobile-storefront/app/bnpl-checkout/`
- **Crypto Payments (USDT / USDC via Juicyway)** (`Storefront`, `Mobile Storefront`, `API`)
  - Multi-network (`TRX`, `ETH`, `MATIC`, `AVAXC`) QR/address checkout and wallet top-up with verification polling.
  - Code: `apps/web/src/app/api/payments/juicyway/webhook/route.ts`, `apps/web/src/app/api/storefront/customer/wallet/top-up/usdt/`
- **Pay-for-Me Links & Instant Invoices/Receipts** (`Storefront`, `Mobile Admin`, `Shared`)
  - Shareable Pay-for-Me checkout links, generated invoices, and sanitized HTML/PDF receipts.
  - Code: `packages/shared/src/receipt/generate-receipt-html.ts`, `apps/web/src/app/api/orders/[id]/invoice/route.ts`
- **Ship on Credit (Deferred Virtual Account)** (`Mobile Admin`, `API`)
  - Dispatch unpaid orders on credit and auto-generate a Paystack DVA for deferred settlement.
  - Code: `apps/web/src/app/api/orders/[id]/ship-on-credit/route.ts`, `apps/mobile-admin/components/orders/ShipOnCreditDialog.tsx`
- **Save-to-Buy Customer Target Savings** (`Storefront`, `Mobile Storefront`, `API`)
  - Goal-based product savings with Paystack recurring auto-debit, manual contributions, pause/resume/cancel, and target swaps.
  - Code: `apps/web/src/app/api/storefront/customer/savings/`, `apps/web/src/app/api/cron/customer-savings/charge-due/route.ts`
- **Paystack Virtual Terminals (Branch & Staff Accounts)** (`Web`, `Mobile Admin`, `API`)
  - Dedicated virtual payment accounts and WhatsApp/notification destinations per branch or staff member.
  - Code: `apps/web/src/app/api/paystack/virtual-terminal/`, `apps/web/src/app/dashboard/settings/payments/components/virtual-terminal-settings.tsx`, `apps/mobile-admin/app/(admin)/staff-accounts.tsx`
- **VTU & Utility Bill Payments** (`Web`, `Storefront`, `Mobile Storefront`, `API`)
  - Kuda-powered airtime, mobile data, cable TV, and electricity purchases with merchant commissions.
  - Code: `apps/web/src/app/dashboard/settings/vtu/`, `apps/web/src/app/api/vtu/`

### AI & Visual Builder
- **3-Step AI Storefront Onboarding** (`Web`)
  - AI Business Name & Logo generators, client-side `@imgly/background-removal`, automatic brand color extraction, password or magic-link signup, and automatic subdomain provisioning.
  - Code: `apps/web/src/components/onboarding/steps/`, `apps/web/src/app/(platform)/onboarding/actions.ts`
- **Puck Visual Builder + Gemini Command Bar + CopilotKit** (`Web`, `Mobile Admin`, `API`)
  - 29+ drag-and-drop storefront blocks across Mobile/Tablet/Desktop viewports, theme/CSS/script editors, background AI layout jobs, natural-language Gemini command bar, and CopilotKit actions.
  - Code: `apps/web/src/app/builder/`, `apps/web/src/components/builder/`, `apps/web/src/app/api/ai-jobs/`, `apps/mobile-admin/app/(admin)/customize.tsx`
- **AI Catalog Paste, Google Sheets Sync & Product/SEO/FAQ Enrichment** (`Web`, `API`)
  - Paste raw price lists for AI parsing, sync linked Google Sheets, bulk CSV import, batch-generate SEO descriptions/SKUs/attributes/FAQs, and fix missing product images.
  - Code: `apps/web/src/app/dashboard/products/use-products-page-actions.ts`, `apps/web/src/app/dashboard/seo/seo-client.tsx`, `apps/web/src/app/api/ai/generate-faq/route.ts`
- **Agentic Commerce (UCP/ACP, WebMCP & LLM Markdown)** (`Web`, `Storefront`, `API`)
  - `/agent-commerce.json`, `/agent-trust.json`, signed UCP/ACP catalog/cart/checkout APIs, WebMCP `modelContext` storefront tools, `.md` LLM renderer (`/api/llm/...`), and merchant crawler/trust dashboard.
  - Code: `apps/web/src/app/dashboard/agentic/client-page.tsx`, `apps/web/src/app/api/agentic/`, `apps/web/src/components/storefront/webmcp-storefront-tools.tsx`

### Operations & Mobile Admin
- **Multi-Branch Switching & 8-Role Staff RBAC** (`Web`, `Mobile Admin`, `API`)
  - Branch CRUD + mobile global branch scope switcher; 8 staff roles (`admin`, `manager`, `sales_rep`, `inventory`, `accountant`, `customer_service`, `marketing`, `fulfillment`) with invite links.
  - Code: `apps/web/src/app/dashboard/staff/`, `apps/web/src/app/api/branches/`, `apps/mobile-admin/components/branches/`
- **Native Camera Barcode / SKU Scanner** (`Mobile Admin`)
  - Scan QR, EAN, UPC, and Code128/39/93 barcodes to open matching products or pre-fill SKUs.
  - Code: `apps/mobile-admin/app/(admin)/scan.tsx`
- **Serialized Unit Inventory & Batch Restock** (`Mobile Admin`)
  - Track serialized units per branch/source, batch-restock units, and scan identifiers during shipment dispatch.
  - Code: `apps/mobile-admin/components/product/ProductRestockSheet.tsx`, `apps/mobile-admin/components/product/VariantInventoryUnitsSheet.tsx`
- **Expenses Tracking, Profit Review & Unlinked Item Reconciliation** (`Mobile Admin`)
  - Expense logging with receipt photo capture, inline cost-price editing for monthly profit review, and matching unlinked custom order items to catalog products.
  - Code: `apps/mobile-admin/app/(admin)/expenses/`, `apps/mobile-admin/app/(admin)/transactions.tsx`, `apps/mobile-admin/app/(admin)/transaction-reconciliation.tsx`
- **CSV/PDF Order, Executive Summary & Tax Ledger Exports** (`Mobile Admin`, `Web`)
  - Branded PDF/CSV order reports, Executive Summaries, and Tax Ledger exports.
  - Code: `apps/mobile-admin/components/ui/OrderReportModal.tsx`, `apps/mobile-admin/components/analytics/ReportsGenerator.ts`
- **Inventory Demand Forecasting, Reorder Alerts & Customer RFM Segments** (`Web`, `API`)
  - Sales-velocity demand forecasting, low-stock push alerts, reorder suggestions, and RFM customer segmentation.
  - Code: `apps/web/src/app/api/inventory/`, `apps/web/src/app/api/customers/segments/`, `apps/web/src/app/dashboard/analytics/`
- **Shipping & Logistics (GIGL, Topship, Airport & Pickup)** (`Web`, `Storefront`, `Mobile Admin`, `API`)
  - Live multi-carrier quotes, booking, cancellation, self-fulfillment, airport/pickup station delivery, rider WhatsApp sharing, and tracking webhooks.
  - Code: `apps/web/src/app/api/shipping/`, `apps/web/src/app/dashboard/settings/shipping/`

### Growth, Domains & Compliance
- **Jumia Marketplace Integration** (`Web`, `Mobile Admin`, `API`)
  - OAuth Seller Center connection, product import/export, stock sync, and order management.
  - Code: `apps/web/src/app/dashboard/channels/`, `apps/web/src/app/api/marketplace/jumia/`, `apps/mobile-admin/app/(admin)/sales-channels.tsx`
- **Ad Pixels, Server-Side CAPI & Daily Spend/ROAS Sync** (`Web`, `Mobile Admin`, `API`)
  - OAuth + spend sync + server-side CAPI across Meta, Google GA4/Ads, TikTok, and Snapchat, plus Safari ITP-safe 90-day click attribution (`/api/attr`).
  - Code: `apps/web/src/app/api/integrations/ads/`, `apps/web/src/app/api/analytics/`, `apps/web/src/app/dashboard/integrations/`
- **Shopping Feeds (Google Merchant, Meta, TikTok, OpenAI JSONL)** (`Web`, `API`)
  - Verified XML and NDJSON/JSONL product feeds with image manifest backing.
  - Code: `apps/web/src/app/feeds/`, `apps/web/src/app/api/feed/`
- **Built-in Blog Engine** (`Web`, `Mobile Admin`, `Storefront`, `API`)
  - Google Discover readiness checks, E-E-A-T author profiles, embedded products, AI editing, RSS feeds, and Zoho Campaigns sync.
  - Code: `apps/web/src/app/dashboard/blog/`, `apps/mobile-admin/app/(admin)/blog/`, `apps/web/src/app/(storefront)/[slug]/(blog)/`
- **Custom Web Domains & Sender Email Domains** (`Web`, `Mobile Admin`, `API`)
  - Search/buy domains via Paystack/Go54, automatic Vercel SSL & Edge Config sync, DNS/WHOIS/email forwarding, and custom sender email domains via ZeptoMail/Resend DNS verification.
  - Code: `apps/web/src/app/dashboard/domains/`, `apps/web/src/app/api/domains/`, `apps/mobile-admin/app/(admin)/email-domain-settings.tsx`
- **Bumpa CSV Migration & Receipt-Claim Campaigns** (`Web`, `Storefront`, `API`)
  - Async CSV import jobs with error inspection and automated customer receipt-claim email campaigns.
  - Code: `apps/web/src/app/dashboard/migrations/`, `apps/web/src/app/api/import-jobs/`, `apps/web/src/app/api/storefront/receipts/claims/`
- **Nigerian KYC (NIN/BVN/CAC) & 7.5% VAT / FIRS TIN** (`Web`, `Mobile Admin`, `API`)
  - In-app NIN, BVN, CAC, and FIRS TIN verification plus structured storefront trust/return/warranty policy pages.
  - Code: `apps/web/src/app/dashboard/settings/kyc/`, `apps/web/src/app/dashboard/settings/tax/`, `apps/web/src/app/dashboard/settings/trust/`
- **Account Security (Passkeys, TOTP 2FA & Recovery Codes)** (`Web`, `Mobile Admin`)
  - WebAuthn passkeys, authenticator app 2FA, one-time recovery codes, and order audit trails.
  - Code: `apps/web/src/app/dashboard/settings/security/`, `apps/mobile-admin/app/(admin)/security.tsx`

---

## 2. Merchant-Specific / Vertical Modules (Ogabassey — NOT General Platform Features)

Do **not** market these on `usebaci.com` or `/features` as general merchant platform capabilities unless explicitly promoted to general availability:
- **Device Repairs Catalog & Courier Pickups** (`apps/web/src/app/dashboard/repairs/`, `apps/web/src/app/api/repairs/`)
- **IMEI / Serial Verification & Carrier Unlock Remediation** (`apps/web/src/app/api/storefront/imei-check/`, `apps/web/src/app/api/storefront/imei-remediation/`)
- **AI Video Device Trade-In / Swap Grading** (`apps/web/src/app/api/ai/grade-device/route.ts`, `apps/mobile-storefront/app/swap/`)
- **Device Insurance / Ogabassey Assurance** (`apps/web/src/app/api/insurance/`, `apps/web/src/app/dashboard/orders/[orderId]/confirm-insurance-dialog.tsx`)
- **Live Trivia / Super Quiz** (`apps/web/src/app/dashboard/quiz/`, `apps/web/src/app/api/merchant/quiz/` — gated to `ogabassey`)
- **Santa AI & Ogabassey Shopping Chat** (`apps/web/src/app/dashboard/santa/`, `apps/web/src/app/api/chat/`)

---

## 3. Known Stubs / Disabled Endpoints (Do NOT Advertise as Live)

- **Shopify One-Click Migration** — placeholder card only (`apps/web/src/app/dashboard/migrations/migration-shopify-placeholder.tsx`).
- **WhatsApp / SMS Automated Order Reminders** — email works via ZeptoMail; WhatsApp/SMS branches return `not yet implemented` (`apps/web/src/app/api/orders/[id]/reminder/route.ts`).
- **Manual Merchant Wallet Withdrawal** — intentionally disabled (`404`); weekly auto-payouts are live (`apps/web/src/app/api/wallet/withdraw/route.ts`).
- **Google Merchant Center OAuth & Webhook** — XML product feed is live; OAuth/webhook routes are stubs (`apps/web/src/app/api/integrations/google-merchant-center/{auth,webhook}/route.ts`).
- **Standalone Gift Card Issuing UI & Loyalty Custom Reward Creation** — `Add Reward` button in `apps/web/src/app/dashboard/loyalty/page.tsx` is currently unwired.
