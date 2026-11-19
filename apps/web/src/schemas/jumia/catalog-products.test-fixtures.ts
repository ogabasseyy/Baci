// Synthetic values following Retrieve Products, verified 2026-10-24:
// https://vendorcenter.jumia.com/api-docs/paths/catalog/catalog@products.yaml
export const retrievedProduct = {
  id: 'd335de79-79c4-4403-b6eb-0ea6a0efe43e',
  name: 'Gaming controller',
  description: 'Synthetic catalog contract fixture',
  parentSku: 'parent-controller',
  shop: { id: 'a8b5534b-277b-449c-97b7-c00979dd9c3a' },
  brand: { code: '1126253', name: 'Controller brand' },
  category: { code: '1004141', name: 'Controllers' },
  additionalCategories: [{ code: '1004142', name: 'Gaming' }],
  images: [
    {
      url: 'https://example.com/controller.jpg',
      originalUrl: 'https://example.com/original.jpg',
      primary: true,
    },
  ],
  attributeSetId: 'b2aa5656-3171-4451-a13c-220bbe6dafcd',
  attributes: [
    {
      id: 'f14c4944-fb9f-4ec5-a057-51259cbb6a0b',
      name: 'color_family',
      value: 'Black',
    },
  ],
  createdAt: '2022-05-16T16:51:08.011663Z',
  updatedAt: '2022-05-16T16:58:50.820Z',
  variations: [
    {
      id: '56243159-15b9-4b59-baba-e416b3c6c113',
      sellerSku: ' SKU/+&=? Exact ',
      barcodeEan: null,
      variation: '1',
      globalPrice: { currency: null, value: null, salePrice: null },
      attributes: [
        {
          id: '5653eb32-af01-4438-9531-4abd7f14a52e',
          name: 'variation',
        },
      ],
      businessClients: [
        {
          code: 'jumia-ng',
          name: 'Jumia',
          countryName: 'Nigeria',
          countryCode: 'NG',
          sku: null,
          visible: false,
          visibleUpdatedAt: null,
          status: 'DELETED',
          qc: {
            status: 'REJECTED',
            updatedAt: '2022-08-16T18:34:17.245137Z',
            lastApprovedAt: '2022-05-16T16:57:52.732856Z',
            rejectionReason: 'Restricted Brand',
            rejectionComment: 'Synthetic rejection',
          },
          price: {
            localCurrency: null,
            localValue: null,
            currency: null,
            value: null,
            salePrice: null,
          },
        },
      ],
    },
  ],
};
