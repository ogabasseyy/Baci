import { order } from '../../../../../setup';
import { json } from '../../fixture-response';
export function POST() {
  return json({ order });
}
