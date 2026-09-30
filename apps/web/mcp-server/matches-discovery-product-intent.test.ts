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
    expect(matchesDiscoveryProductIntent({ name: 'Google Pixel Buds Pro', category: 'Earbuds', description: 'Wireless earbuds' }, 'wireless earbuds')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'HP Wireless Printer', category: 'Printers' }, 'wireless earbuds')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Apple 20W USB-C Fast Charger', category: 'Accessories' }, 'USB C phone charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Xiaomi Smart Camera C300 Home Security Camera', category: 'Cameras' }, 'home security camera')).toBe(true);
  });

  it('honors explicit model anchors without treating a budget as a model', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Redmi 15', category: 'Smartphones' }, 'Redmi 15 smartphone under 300000')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15', category: 'Smartphones' }, 'Redmi 15 smartphone under 300000')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy S24 Ultra', category: 'Smartphones' }, 'Samsung Galaxy S24 Ultra phone')).toBe(true);
  });

  it('treats under, below, and between as price boundaries only with monetary amounts', () => {
    const monitorMount = { name: 'Desk Monitor Mount', category: 'Monitor Accessories' };
    expect(matchesDiscoveryProductIntent(monitorMount, 'under desk monitor mount')).toBe(true);
    expect(matchesDiscoveryProductIntent(monitorMount, 'below desk monitor mount')).toBe(true);
    expect(matchesDiscoveryProductIntent(monitorMount, 'between desk monitor mount')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Redmi 15', category: 'Smartphones' }, 'Redmi 15 phone under 300000')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Redmi 15', category: 'Smartphones' }, 'Redmi 15 phone between 200000 and 300000')).toBe(true);
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
      name: 'Google Pixel Buds 2', category: 'Earbuds', brand: 'Google', description: 'Wireless earbuds',
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
      name: 'Dell Latitude 5420', category: 'Laptops', description: '16GB SSD.',
    }, 'laptop with 16GB RAM')).toBe(false);
    expect(matchesDiscoveryProductIntent({
      name: 'Dell Latitude 5420', category: 'Laptops', description: '16GB RAM, 512GB SSD.',
    }, 'laptop with 16GB RAM512GBSSD')).toBe(true);
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

  it('treats USB-C and USBC as equivalent identity spellings', () => {
    expect(matchesDiscoveryProductIntent({ name: 'USBC Laptop Charger', category: 'Accessories' }, 'USB-C laptop charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'USB-C Laptop Charger', category: 'Accessories' }, 'USBC laptop charger')).toBe(true);
  });

  it('never borrows the capacity of an adjacent different medium', () => {
    const laptop = { name: 'Dell Laptop', category: 'Laptops', description: '16GB RAM, 512GB SSD' };
    expect(matchesDiscoveryProductIntent(laptop, 'laptop with 16GB SSD')).toBe(false);
    expect(matchesDiscoveryProductIntent(laptop, 'laptop with 512GB SSD')).toBe(true);
    expect(matchesDiscoveryProductIntent(laptop, 'laptop with 16GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent(laptop, 'laptop with 512GB RAM')).toBe(false);
    expect(matchesDiscoveryProductIntent({ ...laptop, description: '16 GB RAM, 512 GB SSD' }, 'laptop with 16 GB SSD')).toBe(false);
    expect(matchesDiscoveryProductIntent({ ...laptop, description: '16 GB RAM, 512 GB SSD' }, 'laptop with 512 GB RAM')).toBe(false);
    expect(matchesDiscoveryProductIntent({ ...laptop, description: 'RAM 512GB' }, 'laptop with 512GB RAM')).toBe(true);
  });

  it('does not treat an ordinary word beginning with ram as a memory context', () => {
    expect(matchesDiscoveryProductIntent({ name: '16GB Ramp', category: 'Accessories' }, '16GB ramp')).toBe(true);
  });

  it('permits memory technology qualifiers without crossing another capacity', () => {
    for (const technology of ['DDR4', 'DDR5', 'LPDDR5']) {
      const laptop = { name: 'Dell Laptop', category: 'Laptops', description: `16GB ${technology} RAM, 512GB SSD` };
      expect(matchesDiscoveryProductIntent(laptop, 'laptop with 16GB RAM')).toBe(true);
      expect(matchesDiscoveryProductIntent(laptop, 'laptop with 16GB SSD')).toBe(false);
    }
  });

  it('keeps laptop accessory intents distinct from bare laptops', () => {
    const laptop = { name: 'Dell Latitude 5420', category: 'Laptops' };
    for (const accessory of ['bag', 'sleeve', 'dock', 'hub']) {
      expect(matchesDiscoveryProductIntent(laptop, `laptop ${accessory}`)).toBe(false);
      expect(matchesDiscoveryProductIntent({ name: `Universal Laptop ${accessory}`, category: 'Laptop Accessories' }, `laptop ${accessory}`)).toBe(true);
    }
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
});
