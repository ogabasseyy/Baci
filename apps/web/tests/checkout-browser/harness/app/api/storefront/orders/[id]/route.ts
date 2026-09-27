import { order } from '../../../../../../setup';
import { json } from '../../../fixture-response';

export function GET() {
  return json(order);
}
