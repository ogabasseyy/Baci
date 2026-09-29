import { describe, expect, it } from 'vitest';
import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';

describe('discovery product intent', () => {
  it('does not sell a phone or camera pouch as an iPhone 15 case', () => {
    const phone = { name: 'iPhone 15', category: 'Smartphones', description: 'Apple iPhone 15 with USB-C and a 48MP camera.' };
    const cameraPouch = { name: 'FUJIFILM instax mini 12 Camera Pouch', category: 'Camera Accessories' };
    const caseProduct = { name: 'Protective Case for iPhone 15', category: 'Accessories' };
    expect(matchesDiscoveryProductIntent(phone, 'iPhone 15 case')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      ...phone, description: 'iPhone 15 handset. Case sold separately.',
    }, 'iPhone 15 case')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'iPhone 15 USB-C Cable', category: 'Phone Accessories',
      description: 'Case sold separately.',
    }, 'iPhone 15 case')).toBe(false);
    expect(matchesDiscoveryProductIntent(cameraPouch, 'iPhone 15 pouch')).toBe(false);
    expect(matchesDiscoveryProductIntent(caseProduct, 'case for iPhone 15')).toBe(true);
  });

  it('finds a power bank described by its item type while dropping unrelated power matches', () => {
    expect(matchesDiscoveryProductIntent({
      name: 'Riversong Vision 20S 20000mAh', category: 'Accessories',
      description: 'Riversong Vision 20S 20000mAh is a Riversong power bank.',
    }, 'power bank for phone')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Power Cable', category: 'Gaming Accessories' }, 'power bank for phone')).toBe(false);
  });

  it('keeps the named product type for earbuds, chargers, and cameras', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Google Pixel Buds Pro', category: 'Earbuds' }, 'wireless earbuds')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'HP Wireless Printer', category: 'Printers' }, 'wireless earbuds')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Apple Fast Charger 20W', category: 'Accessories' }, 'USB C phone charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Xiaomi Smart Camera C300 Home Security Camera', category: 'Cameras' }, 'home security camera')).toBe(true);
  });

  it('honors explicit model anchors without treating a budget as a model', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Redmi 15', category: 'Smartphones' }, 'Redmi 15 smartphone under 300000')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15', category: 'Smartphones' }, 'Redmi 15 smartphone under 300000')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy S24 Ultra', category: 'Smartphones' }, 'Samsung Galaxy S24 Ultra phone')).toBe(true);
  });

  it('keeps brand-specific phone searches and excludes phone accessories', () => {
    const samsung = { name: 'Samsung Galaxy A55', category: 'Smartphones', brand: 'Samsung' };
    const redmi = { name: 'Redmi 15', category: 'Smartphones', brand: 'Xiaomi' };
    const apple = { name: 'Apple iPhone 15', category: 'Smartphones', brand: 'Apple' };
    const pouch = { name: 'Phone Pouch', category: 'Accessories', description: 'A pouch for your phone' };
    expect(matchesDiscoveryProductIntent(samsung, 'Samsung phone')).toBe(true);
    expect(matchesDiscoveryProductIntent(apple, 'Samsung phone')).toBe(false);
    expect(matchesDiscoveryProductIntent(redmi, 'redmi phone')).toBe(true);
    expect(matchesDiscoveryProductIntent(samsung, 'redmi phone')).toBe(false);
    expect(matchesDiscoveryProductIntent(pouch, 'cheap phone')).toBe(false);
    expect(matchesDiscoveryProductIntent(apple, 'cheap phone')).toBe(true);
  });

  it('rejects compatibility products and preserves typed trailing-model searches', () => {
    expect(matchesDiscoveryProductIntent({
      name: 'Protective Case for AirPods Earbuds', category: 'Accessories',
    }, 'wireless earbuds')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'Google Pixel Buds 2', category: 'Earbuds', brand: 'Google',
    }, 'wireless earbuds 2')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'Wireless Printer 2', category: 'Printers',
    }, 'wireless earbuds 2')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'HP Wireless Printer Pro', category: 'Printers',
    }, 'wireless earbuds pro')).toBe(false);
  });

  it('requires brands and model qualifiers in the product identity', () => {
    expect(matchesDiscoveryProductIntent({
      name: 'Samsung 20W Charger', brand: 'Samsung', category: 'Accessories',
    }, 'Samsung charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: '20W Charger', brand: 'Generic', category: 'Accessories',
      description: 'Compatible with Samsung devices',
    }, 'Samsung charger')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'iPhone 15 Case', category: 'Accessories',
    }, 'iPhone 15 Pro case')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'iPhone 15 Pro Case', category: 'Accessories',
    }, 'iPhone 15 Pro case')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'iPhone 15 Pro Case', category: 'Accessories',
    }, 'iPhone 15 Pro Max case')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'iPhone 15 Pro Max Case', category: 'Accessories',
    }, 'iPhone 15 Pro Max case')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'iPhone 15 Pro Max Case', category: 'Accessories',
    }, 'iPhone 15 Pro case')).toBe(false);
  });

  it('rejects incompatible accessory titles and compatibility brands', () => {
    expect(matchesDiscoveryProductIntent({
      name: 'Laptop Case', category: 'Laptop Accessories',
    }, 'cheap laptop')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'iPhone 15 Case', brand: 'Apple', category: 'Accessories',
      description: 'Protective case compatible with iPhone 15.',
    }, 'case for Samsung phone')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'Protective Case for Samsung Galaxy S24', brand: 'Generic', category: 'Accessories',
    }, 'case for Samsung phone')).toBe(true);
  });

  it('keeps specification numbers out of model matching and recognizes ordinary description wording', () => {
    expect(matchesDiscoveryProductIntent({
      name: 'Dell Latitude 5420', category: 'Laptops', description: 'Laptop with 16GB RAM.',
    }, 'laptop with 16GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'Riversong Vision 20S 20000mAh', category: 'Accessories',
      description: 'A compact 20,000mAh power bank for phones.',
    }, 'power bank')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'Riversong Vision 20S 20000mAh', category: 'Accessories',
      description: 'A compact power banks for phones.',
    }, 'power banks')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'Dell Latitude 5420', category: 'Laptops', description: 'Laptop with 8GB RAM.',
    }, 'laptop with 16GB RAM')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'Dell Latitude 5420', category: 'Laptops', description: '16GB storage.',
    }, 'laptop with 16GB RAM')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'Dell Latitude 5420', category: 'Laptops', description: '8GB storage, 16GB RAM.',
    }, 'laptop with 16GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'Riversong Power Bank', category: 'Accessories', description: 'Capacity 30,000mAh.',
    }, 'power bank 30,000mAh')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'Riversong Vision 20S', category: 'Accessories',
      description: 'Ideal for phones and includes a free phone case.',
    }, 'phone case')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'Riversong Vision 20S', category: 'Accessories',
      description: 'Compact item with free phone case.',
    }, 'phone case')).toBe(false);
  });

  it.each(['please show me Samsung phones', 'could you find a Samsung phone'])('strips polite request lead-in from %s', (query) => {
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy A55', category: 'Smartphones' }, query)).toBe(true);
  });
  it.each(['please show me phones', 'could you find a phone'])('retains handset intent after stripping %s', (query) => {
    expect(matchesDiscoveryProductIntent({ name: 'HP LaserJet Printer', category: 'Printers' }, query)).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy A55', category: 'Smartphones' }, query)).toBe(true);
  });

  it('honors explicit phone accessories intent and compatibility device families', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Protective Phone Case', category: 'Accessories' }, 'phone accessories')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15', category: 'Smartphones' }, 'phone accessories')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy Case', category: 'Accessories' }, 'case for iPhone')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Generic Case for iPhone', category: 'Accessories' }, 'case for iPhone')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy Case', category: 'Accessories' }, 'case for AirPods')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Generic Case for AirPods', category: 'Accessories' }, 'case for AirPods')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone Case', category: 'Accessories' }, 'case for Galaxy')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy Case', category: 'Accessories' }, 'case for Galaxy')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Case for iPhone 15 Pro Max', category: 'Accessories' }, 'case for iPhone 15 Pro')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Case for iPhone 15 Pro', category: 'Accessories' }, 'case for iPhone 15 Pro')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'Protective Case for iPhone, MagSafe compatible', category: 'Accessories',
    }, 'case for iPhone with MagSafe')).toBe(true);
  });

  it('retains compound product types and ignores generic trailing nouns without dropping explicit intent', () => {
    expect(matchesDiscoveryProductIntent({ name: 'HP All-in-One Printer', category: 'Printers' }, 'all in one printer')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Lenovo Yoga 2-in-1 Laptop', category: 'Laptops' }, '2 in 1 laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'HP LaserJet Printer', category: 'Printers' }, 'iPhone 15 device')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'HP LaserJet Printer', category: 'Printers' }, 'Samsung phone products')).toBe(false);
  });

  it('filters additional catalog product types and unlisted laptop brands', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Wireless Mouse', category: 'Accessories' }, 'wireless keyboard')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Logitech Wireless Keyboard', category: 'Accessories' }, 'wireless keyboard')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude Laptop', brand: 'Dell', category: 'Laptops' }, 'ASUS laptop')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'ROG Strix G16', brand: 'ASUS', category: 'Laptops' }, 'ASUS laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'MSI Katana', brand: 'MSI', category: 'Laptops' }, 'MSI laptop')).toBe(true);
  });

  it('keeps one-word model and specification queries attached to their candidates', () => {
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 14', category: 'Smartphones' }, 'iPhone 15')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'MacBook Air M2', category: 'Laptops' }, 'MacBook M3')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'MacBook Air M3', category: 'Laptops' }, 'MacBook M3')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: '30W USB-C Charger', category: 'Accessories' }, '20w charger')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: '20W USB-C Charger', category: 'Accessories' }, '20w charger')).toBe(true);
  });

  it('checks device nouns that qualify an accessory type', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Camera Case', category: 'Accessories' }, 'phone case')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Camera Case', category: 'Accessories', description: 'Compatible with iPhone' }, 'phone case')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15 Case', category: 'Accessories' }, 'phone case')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'USB-C Phone Charger', category: 'Phone Accessories' }, 'laptop charger')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'USB-C Laptop Charger', category: 'Accessories' }, 'laptop charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone Lens', category: 'Accessories' }, 'camera lens')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Sony Camera Lens', category: 'Camera Accessories' }, 'camera lens')).toBe(true);
  });

  it('accepts candidates matching any explicitly joined product type', () => {
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15', category: 'Smartphones' }, 'phone or laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', category: 'Laptops' }, 'phone or laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone Case', category: 'Accessories' }, 'phone or laptop')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'iPad Air', category: 'Tablets' }, 'phone or laptop')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Phone Case', category: 'Accessories' }, 'phone case or charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'USB-C Charger', category: 'Accessories' }, 'phone case or charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone Case', category: 'Accessories' }, 'phone case or charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy S24', category: 'Smartphones' }, 'Samsung phone or Dell laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', category: 'Laptops' }, 'Samsung phone or Dell laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'ASUS Zenbook', category: 'Laptops' }, 'Samsung phone or Dell laptop')).toBe(false);
  });

  it('matches mouse and television aliases in both directions', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Mice', category: 'Accessories' }, 'wireless mouse')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Wireless Mouse', category: 'Accessories' }, 'wireless mice')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: '4K TV', category: 'Televisions' }, 'television')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: '4K Television', category: 'Electronics' }, 'TV')).toBe(true);
  });

  it.each([
    ['pouches', 'Phone Pouch'], ['watches', 'Smart Watch'],
    ['lenses', 'Camera Lens'], ['mice', 'Wireless Mouse'],
  ])('matches plural %s to a singular product name', (query, name) => {
    expect(matchesDiscoveryProductIntent({ name, category: 'Accessories' }, `wireless ${query}`)).toBe(true);
  });

  it('leaves single-word and untyped model searches to their existing guards', () => {
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15' }, 'iPhone 15')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Office Laptop' }, 'work')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Logitech Wireless Mouse' }, '2.4G wireless mouse')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Office Laptop' }, 'something for work')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Protective Phone Case', category: 'Phone Accessories' }, 'phone case')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Phone Accessories Bundle', category: 'Phone Accessories' }, 'cheap phone')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: '20 W Fast Charger', category: 'Accessories' }, '20w charger')).toBe(true);
  });

  it('keeps an explicit phone accessories request out of handset results', () => {
    expect(matchesDiscoveryProductIntent({
      name: 'Protective Phone Case', category: 'Phone Accessories',
    }, 'phone accessories')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'USB-C Phone Charger', category: 'Phone Accessories',
    }, 'phone accessories')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'iPhone 15', category: 'Smartphones',
    }, 'phone accessories')).toBe(false);
  });

  it('accepts descriptive modifiers from the category and description lead', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', brand: 'Dell', category: 'Business Laptops' }, 'business laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Galaxy Buds', category: 'Accessories', description: 'Noise cancelling wireless earbuds' }, 'noise cancelling earbuds')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude Laptop', brand: 'Dell', category: 'Laptops' }, 'ASUS laptop')).toBe(false);
  });

  it('validates specifications written with separated units', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', category: 'Laptops', description: '16 GB RAM, 512 GB SSD' }, 'laptop with 16 GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', category: 'Laptops', description: '8 GB RAM, 256 GB SSD' }, 'laptop with 16 GB RAM')).toBe(false);
  });

  it('keeps numeric constraints local to each alternative', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', category: 'Laptops' }, 'iPhone 15 case or Dell laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15 Case', category: 'Accessories' }, 'iPhone 15 case or Dell laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 14 Case', category: 'Accessories' }, 'iPhone 15 case or Dell laptop')).toBe(false);
  });

  it('treats lower-bound phrases as price boundaries', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', category: 'Laptops' }, 'laptop over 500000')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', category: 'Laptops' }, 'laptop above 500000')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', category: 'Laptops' }, 'laptop from 500000')).toBe(true);
  });

  it('validates identity terms placed after the product type', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Samsung USB-C Charger', brand: 'Samsung', category: 'Accessories' }, 'charger from Samsung')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'USB-C Charger', category: 'Accessories' }, 'charger from Samsung')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Galaxy S24', brand: 'Samsung', category: 'Smartphones' }, 'phone Samsung')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15', category: 'Smartphones' }, 'phone Samsung')).toBe(false);
  });

  it('shares a trailing noun across coordinated phrases', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', brand: 'Dell', category: 'Laptops' }, 'Dell or ASUS laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'ROG Strix G16', brand: 'ASUS', category: 'Laptops' }, 'Dell or ASUS laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Acer Aspire', brand: 'Acer', category: 'Laptops' }, 'Dell or ASUS laptop')).toBe(false);
  });

  it('matches singular queries against plural catalog wording', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Camera Lenses', category: 'Accessories' }, 'camera lens')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Phone Pouches', category: 'Accessories' }, 'phone pouch')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Smart Watch', category: 'Watches' }, 'smart watch')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Drawing Styluses', category: 'Accessories' }, 'drawing stylus')).toBe(true);
  });
});
