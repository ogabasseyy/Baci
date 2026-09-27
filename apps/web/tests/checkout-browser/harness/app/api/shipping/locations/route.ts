import { json } from '../../fixture-response';
export function GET() {
  return json({
    states: ['Lagos'],
    locations: [{ city: 'Ikeja', state: 'Lagos' }],
  });
}
