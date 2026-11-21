const context = {
  merchantId: 'merchant-one',
  installationId: 'installation-one',
  storefrontOrigin: 'https://shop.example.invalid',
};
const facts = {
  specifications: '<strong>128 GB</strong>',
  boxContents: 'Phone and cable',
  warranty: '30 days',
};
const base = {
  ...context,
  categoryId: 'phones',
  name: 'Pilot phone',
  currency: 'NGN',
  priceNaira: 350000,
  visible: true,
  inventory: { kind: 'quantity', units: 2 },
  approvedFacts: facts,
  verifiedImages: ['https://images.example.invalid/phone.jpg'],
} as const;

export const catalogueFixture = { base, context, facts };
