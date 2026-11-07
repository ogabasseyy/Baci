import Image, { type StaticImageData } from 'next/image';
import altbank from '@/../public/partners/bank-icons/altbank-generated.png';
import citi from '@/../public/partners/bank-icons/citibank.png';
import heritage from '@/../public/partners/bank-icons/heritage.png';
import jaiz from '@/../public/partners/bank-icons/jaiz.png';
import premium from '@/../public/partners/bank-icons/premium.png';
import standard from '@/../public/partners/bank-icons/standard.png';
import suntrust from '@/../public/partners/bank-icons/suntrust.png';
import coronation from '@/../public/partners/bank-icons/coronation.png';
import palmpay from '@/../public/partners/bank-icons/palmpay.png';
import kongapay from '@/../public/partners/bank-icons/kongapay.png';
import piggyvest from '@/../public/partners/bank-icons/piggyvest-symbol.png';
import cowrywise from '@/../public/partners/bank-icons/cowrywise-symbol.png';
import risevest from '@/../public/partners/bank-icons/risevest-symbol.png';
import trove from '@/../public/partners/bank-icons/trove-symbol.png';
import { OxygenBankLogo } from '@/components/payments/oxygen/OxygenBankLogo';
import styles from './finance-provider-option.module.css';
const images: Readonly<Record<string, StaticImageData>> = {
  'citi bank': citi, 'heritage bank': heritage, 'jaiz bank': jaiz,
  'premium trust bank': premium, 'standard chartered': standard,
  'suntrust bank': suntrust, 'coronation merchant bank': coronation,
  altbank, palmpay, kongapay, piggyvest, cowrywise, risevest, trove,
};
export function FinanceBankLogo({ name, code }: { name: string; code: string }) {
  const image = images[name.trim().toLowerCase()];
  return <span className={styles.bankLogo} data-bank={name} aria-hidden="true">{image ? <Image src={image} alt="" width={28} height={28} /> : <OxygenBankLogo code={code} />}</span>;
}
