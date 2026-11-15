import { CreditCard, Leaf, Smartphone, Wallet } from 'lucide-react';

const benefits = [
  {
    Icon: Smartphone,
    title: 'Premium pre-owned',
    description: 'More device for your money.',
  },
  {
    Icon: CreditCard,
    title: '25–40% upfront',
    description: 'Eligible plans over 3–6 months.',
  },
  {
    Icon: Wallet,
    title: 'Save towards it',
    description: 'Build your next-device fund.',
  },
  {
    Icon: Leaf,
    title: 'Keep tech in use',
    description: 'Repair, reuse. Less e-waste.',
  },
];

/** Plain server HTML: included in the hero and its invisible stream reserve. */
export function AccessBenefits() {
  return (
    <ul className="oa-benefits" aria-label="Why Ogabassey">
      {benefits.map(({ Icon, title, description }, index) => (
        <li key={title}>
          <div className="oa-benefit-top">
            <span className="oa-benefit-icon">
              <Icon size={18} aria-hidden="true" />
            </span>
            <span aria-hidden="true">0{index + 1}</span>
          </div>
          <h3>{title}</h3>
          <p>{description}</p>
        </li>
      ))}
    </ul>
  );
}
