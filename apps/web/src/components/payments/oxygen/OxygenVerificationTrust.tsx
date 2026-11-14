import Image from 'next/image';
import oxygenLogo from '../../../../public/partners/oxygen-x.png';
import styles from './OxygenVerificationTrust.module.css';

/** Official logo: https://corporate.oxygenx.africa/logo.png. */
export function OxygenVerificationTrust() {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-gray-50 p-4">
      <Image
        src={oxygenLogo}
        alt="Oxygen X Finance Company"
        width={264}
        height={145}
        className={`${styles.logo} h-10 w-auto shrink-0`}
      />
      <div className="min-w-0 max-w-sm space-y-1">
        <p className="text-xs font-medium text-gray-700">
          Identity verification by Oxygen X
        </p>
        <p className="text-balance text-xs leading-relaxed text-gray-500">
          A subsidiary of Access Holdings, Access Bank’s parent company.
        </p>
      </div>
    </div>
  );
}
