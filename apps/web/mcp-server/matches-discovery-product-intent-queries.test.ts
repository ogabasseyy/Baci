import { describe, expect, it } from 'vitest';
import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';

describe('discovery product intent', () => {

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
    expect(matchesDiscoveryProductIntent({ name: 'Wireless Mice', category: 'Accessories' }, 'wireless mouse')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Wireless Mouse', category: 'Accessories' }, 'wireless mice')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: '4K TV', category: 'Televisions' }, 'television')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: '4K Television', category: 'Electronics' }, 'TV')).toBe(true);
  });

  it.each([
    ['pouches', 'Phone Pouch'], ['watches', 'Smart Watch'],
    ['lenses', 'Camera Lens'], ['mice', 'Wireless Mouse'],
  ])('matches plural %s to a singular product name', (query, name) => {
    expect(matchesDiscoveryProductIntent({ name, category: 'Accessories' }, `compact ${query}`)).toBe(true);
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

  it('keeps descriptive conjunctions in one intent but splits type lists', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Wireless Earbuds', category: 'Accessories' }, 'noise cancelling and wireless earbuds')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Noise Cancelling Wireless Earbuds', category: 'Accessories' }, 'noise cancelling and wireless earbuds')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15', category: 'Smartphones' }, 'phones and tablets')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPad Air', category: 'Tablets' }, 'phones and tablets')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', category: 'Laptops' }, 'phones and tablets')).toBe(false);
  });

  it('validates each alternative against its own model numbers', () => {
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15 Case', category: 'Accessories' }, 'iPhone 15 case or iPhone 14 case')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 14 Case', category: 'Accessories' }, 'iPhone 15 case or iPhone 14 case')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 13 Case', category: 'Accessories' }, 'iPhone 15 case or iPhone 14 case')).toBe(false);
  });

  it('enforces the remaining term when no product type is recognized', () => {
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15', category: 'Smartphones' }, 'find iPhone')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'HP Printer', category: 'Printers' }, 'find iPhone')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Dell XPS 13', brand: 'Dell', category: 'Laptops' }, 'dell xps')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', brand: 'Dell', category: 'Laptops' }, 'dell xps')).toBe(false);
  });

  it('requires model qualifiers even without a numeric anchor', () => {
    expect(matchesDiscoveryProductIntent({ name: 'MacBook Air M3', category: 'Laptops' }, 'MacBook Pro')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'MacBook Pro M3', category: 'Laptops' }, 'MacBook Pro')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15', category: 'Smartphones' }, 'iPhone Pro')).toBe(false);
  });

  it('shares a trailing noun across and-conjunctions led by brands', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', brand: 'Dell', category: 'Laptops' }, 'Dell and ASUS laptops')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'ROG Strix G16', brand: 'ASUS', category: 'Laptops' }, 'Dell and ASUS laptops')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Acer Aspire', brand: 'Acer', category: 'Laptops' }, 'Dell and ASUS laptops')).toBe(false);
  });

  it('enforces explicit wireless and connector modifiers', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Mice', category: 'Accessories' }, 'wireless mouse')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Lightning Charger', category: 'Accessories' }, 'USB-C charger')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'USB-C Charger', category: 'Accessories' }, 'USB-C charger')).toBe(true);
  });

  it('restricts recognized brands to the name and brand fields', () => {
    expect(matchesDiscoveryProductIntent({ name: 'HP Pavilion', brand: 'HP', category: 'Laptops', description: 'Compare this laptop to Dell Latitude' }, 'Dell laptop')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', brand: 'Dell', category: 'Laptops' }, 'Dell laptop')).toBe(true);
  });

  it('excludes accessory subcategories from handset detection', () => {
    expect(matchesDiscoveryProductIntent({ name: 'USB-C Phone Charger', category: 'Phone Chargers' }, 'phone charger')).toBe(true);
  });

  it('matches hyphenated and compact model spellings in both directions', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Sony WH1000XM5 Wireless Headphones', category: 'Headphones' }, 'Sony WH-1000XM5 headphones')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Sony WH-1000XM5', category: 'Headphones' }, 'Sony WH1000XM5 headphones')).toBe(true);
  });

  it('recognizes mount and tripod accessory heads', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Adjustable Phone Mount', category: 'Phone Accessories' }, 'phone mount')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Phone Tripod', category: 'Accessories' }, 'phone tripod')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Adjustable Phone Mount', category: 'Phone Accessories' }, 'cheap phone')).toBe(false);
  });

  it('parses compatibility phrases beyond for', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Protective Case', category: 'Accessories', description: 'Compatible with iPhone 15' }, 'case compatible with iPhone 15')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy Case', category: 'Accessories', description: 'Compatible with Galaxy S24' }, 'case compatible with iPhone 15')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Protective Case', category: 'Accessories', description: 'Fits iPhone 15' }, 'case that fits iPhone 15')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy Case', category: 'Accessories', description: 'Fits Galaxy S24' }, 'case that fits iPhone 15')).toBe(false);
  });

  it('validates single-digit models attached to a family', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Google Pixel 9', brand: 'Google', category: 'Smartphones' }, 'Google Pixel 9 phone')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Google Pixel 8 Pro', brand: 'Google', category: 'Smartphones' }, 'Google Pixel 9 phone')).toBe(false);
  });

  it('keeps Apple handsets out of Android searches', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy S24', brand: 'Samsung', category: 'Smartphones' }, 'Android phones')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15', category: 'Smartphones' }, 'Android phones')).toBe(false);
  });
});
