import { json } from '../../fixture-response';
export function POST() {
  return json({ invalidProductIds: [], priceChanges: [] });
}
