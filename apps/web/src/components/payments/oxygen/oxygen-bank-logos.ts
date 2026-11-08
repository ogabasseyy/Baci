import type { StaticImageData } from 'next/image';
import logo011 from '@/assets/bank-logos/011.png';
import logo032 from '@/assets/bank-logos/032.png';
import logo033 from '@/assets/bank-logos/033.png';
import logo035 from '@/assets/bank-logos/035.png';
import logo044 from '@/assets/bank-logos/044.png';
import logo050 from '@/assets/bank-logos/050.png';
import logo057 from '@/assets/bank-logos/057.png';
import logo058 from '@/assets/bank-logos/058.png';
import logo070 from '@/assets/bank-logos/070.png';
import logo076 from '@/assets/bank-logos/076.png';
import logo082 from '@/assets/bank-logos/082.png';
import logo101 from '@/assets/bank-logos/101.png';
import logo102 from '@/assets/bank-logos/102.png';
import logo104 from '@/assets/bank-logos/104.png';
import logo107 from '@/assets/bank-logos/107.png';
import logo214 from '@/assets/bank-logos/214.png';
import logo215 from '@/assets/bank-logos/215.png';
import logo221 from '@/assets/bank-logos/221.png';
import logo232 from '@/assets/bank-logos/232.png';
import logo303 from '@/assets/bank-logos/303.png';
import logo566 from '@/assets/bank-logos/566.png';
import logo601 from '@/assets/bank-logos/601.png';
import logo50211 from '@/assets/bank-logos/50211.png';
import logo50515 from '@/assets/bank-logos/50515.png';
import logo999991 from '@/assets/bank-logos/999991.png';
import logo999992 from '@/assets/bank-logos/999992.png';

/** Presentation only. Exact sort-code and NIP aliases from the pinned asset source. */
const logos: Readonly<Record<string, StaticImageData>> = {
  '044': logo044,
  '000014': logo044,
  '050': logo050,
  '000010': logo050,
  '070': logo070,
  '000007': logo070,
  '011': logo011,
  '000016': logo011,
  '214': logo214,
  '000003': logo214,
  '601': logo601,
  '400001': logo601,
  '058': logo058,
  '000013': logo058,
  '082': logo082,
  '000002': logo082,
  '50211': logo50211,
  '090267': logo50211,
  '303': logo303,
  '000029': logo303,
  '50515': logo50515,
  '090405': logo50515,
  '999992': logo999992,
  '100004': logo999992,
  '107': logo107,
  '000036': logo107,
  '999991': logo999991,
  '100033': logo999991,
  '104': logo104,
  '000030': logo104,
  '076': logo076,
  '000008': logo076,
  '101': logo101,
  '000023': logo101,
  '221': logo221,
  '000012': logo221,
  '232': logo232,
  '000001': logo232,
  '102': logo102,
  '000025': logo102,
  '032': logo032,
  '000018': logo032,
  '033': logo033,
  '000004': logo033,
  '215': logo215,
  '000011': logo215,
  '566': logo566,
  '090110': logo566,
  '035': logo035,
  '000017': logo035,
  '057': logo057,
  '000015': logo057,
};

export function oxygenBankLogo(code: string): StaticImageData | undefined {
  return Object.hasOwn(logos, code) ? logos[code] : undefined;
}
