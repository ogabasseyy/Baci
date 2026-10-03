export const categoryGuidanceCases = {
  camera: {
    prompt: 'Find the Xiaomi Smart Camera C300 and show its photo and current listed price. Do not add it to cart.',
    productType: 'security_camera',
    model: 'C300',
    modelAliases: ['Smart Camera C300'],
    productId: 'bfab9f45-7c2e-4744-be8e-9540af062406',
    brand: 'Xiaomi',
    category: undefined,
  },
  tecno: {
    prompt: 'Show the Tecno Spark 50 photo and current listed price. Do not add it to cart.',
    productType: 'phone',
    model: 'Spark 50',
    modelAliases: ['Spark50'],
    productId: '02f16ba8-0349-41f2-a7a3-bc0ee6874560',
    brand: 'Tecno',
    category: undefined,
  },
  explicitCategory: {
    prompt: 'Find the Xiaomi Smart Camera C300 in the Cameras catalog category. Show its photo and current listed price. Do not add it to cart.',
    productType: 'security_camera',
    model: 'C300',
    modelAliases: ['Smart Camera C300'],
    productId: 'bfab9f45-7c2e-4744-be8e-9540af062406',
    brand: 'Xiaomi',
    category: 'Cameras',
  },
} as const;
