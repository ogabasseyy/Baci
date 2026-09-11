import { escapeXml } from '@/lib/xml-utils';
export function buildBaseItemXml(args: {
  additionalImagesXml: string;
  availability: string;
  brandName: string;
  compareAtPrice?: number;
  condition: string;
  colorXml?: string;
  currency: string;
  description: string;
  googleProductCategory?: string;
  id: string;
  imageUrl: string;
  price: number;
  productType?: string;
  shippingWeight: string;
  stockCount: number;
  title: string;
  url: string;
  gtin?: string;
  mpn?: string;
  productDetailsXml?: string;
}) {
  const formattedPrice = args.price.toFixed(2);
  const priceLines =
    typeof args.compareAtPrice === 'number' && args.compareAtPrice > args.price
      ? [
          `        <g:sale_price>${formattedPrice} ${args.currency}</g:sale_price>`,
          `        <g:price>${args.compareAtPrice.toFixed(2)} ${args.currency}</g:price>`,
        ]
      : [`        <g:price>${formattedPrice} ${args.currency}</g:price>`];
  const lines = [
    `        <g:id>${escapeXml(args.id)}</g:id>`,
    `        <g:title>${escapeXml(args.title)}</g:title>`,
    `        <g:description>${escapeXml(args.description)}</g:description>`,
    `        <g:link>${escapeXml(args.url)}</g:link>`,
    `        <g:image_link>${escapeXml(args.imageUrl)}</g:image_link>`,
    args.additionalImagesXml,
    `        <g:availability>${args.availability}</g:availability>`,
    `        <g:quantity>${args.stockCount}</g:quantity>`,
    ...priceLines,
    `        <g:brand>${escapeXml(args.brandName)}</g:brand>`,
    `        <g:condition>${args.condition}</g:condition>`,
    args.gtin ? `        <g:gtin>${escapeXml(args.gtin)}</g:gtin>` : '',
    args.mpn ? `        <g:mpn>${escapeXml(args.mpn)}</g:mpn>` : '',
    args.gtin || (args.mpn && args.brandName)
      ? '        <g:identifier_exists>yes</g:identifier_exists>'
      : '        <g:identifier_exists>no</g:identifier_exists>',
    args.colorXml,
    args.productDetailsXml,
    args.googleProductCategory
      ? `        <g:google_product_category>${escapeXml(args.googleProductCategory)}</g:google_product_category>`
      : '',
    args.productType
      ? `        <g:product_type>${escapeXml(args.productType)}</g:product_type>`
      : '',
    args.shippingWeight,
  ].filter(Boolean);

  return `    <item>\n${lines.join('\n')}\n    </item>`;
}
