import { BriefcaseBusiness, Landmark, ShieldCheck } from 'lucide-react';
import styles from './OxygenStepHeading.module.css';

const icons = {
  identity: ShieldCheck,
  bank: Landmark,
  income: BriefcaseBusiness,
};

const titles = {
  identity: 'Verify your identity',
  bank: 'Verify your bank account',
  income: 'Employment and consent',
};

export function OxygenStepHeading({ step }: { step: keyof typeof icons }) {
  const Icon = icons[step];
  return (
    <div className="flex items-center gap-3">
      <span className={styles.badge}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <h3 className="text-lg font-bold text-gray-900">{titles[step]}</h3>
    </div>
  );
}
