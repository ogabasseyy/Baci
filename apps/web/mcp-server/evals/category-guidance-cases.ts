export const categoryGuidanceCases = {
  camera: {
    prompt: 'Find the Xiaomi Smart Camera C300 and show its photo and current listed price. Do not add it to cart.',
    productType: 'security_camera',
    model: 'C300',
    brand: 'Xiaomi',
    category: undefined,
  },
  tecno: {
    prompt: 'Show the Tecno Spark 50 photo and current listed price. Do not add it to cart.',
    productType: 'phone',
    model: 'Spark 50',
    brand: 'Tecno',
    category: undefined,
  },
  explicitCategory: {
    prompt: 'Find the Xiaomi Smart Camera C300 in the Cameras catalog category. Show its photo and current listed price. Do not add it to cart.',
    productType: 'security_camera',
    model: 'C300',
    brand: 'Xiaomi',
    category: 'Cameras',
  },
} as const;
