import { json } from '../fixture-response';
export function GET() {
  return json({ token: 'fixture-csrf-token' });
}
