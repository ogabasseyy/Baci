import { json } from '../../fixture-response';

export function GET() {
  return json({ predictions: [] });
}
