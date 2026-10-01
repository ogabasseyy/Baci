import { json } from '../../../fixture-response';
export function GET() {
  return json({ enabled: false, available: false });
}
