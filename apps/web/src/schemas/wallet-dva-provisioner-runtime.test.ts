import { describe, expect, it } from 'vitest';
import { readWalletDvaProvisionerRuntime } from './wallet-dva-provisioner-runtime';

const validEnvironment = {
  WALLET_DVA_PROVISIONER_ENABLED: 'true',
  WALLET_DVA_PROVISIONER_DB_CA: 'test-ca',
  WALLET_DVA_PROVISIONER_DB_HOST: 'db.example.test',
  WALLET_DVA_PROVISIONER_DB_NAME: 'postgres',
  WALLET_DVA_PROVISIONER_DB_PASSWORD: 'synthetic-only-password',
  WALLET_DVA_PROVISIONER_DB_PORT: '5432',
};

describe('wallet DVA restricted writer runtime', () => {
  it('stays disabled until its separate runtime contract is configured', () => {
    expect(readWalletDvaProvisionerRuntime({})).toBeNull();
    expect(
      readWalletDvaProvisionerRuntime({
        ...validEnvironment,
        WALLET_DVA_PROVISIONER_ENABLED: 'false',
      })
    ).toBeNull();
  });

  it('accepts only a complete, fixed-login worker configuration', () => {
    expect(readWalletDvaProvisionerRuntime(validEnvironment)).toEqual({
      database: {
        certificateAuthority: 'test-ca',
        host: 'db.example.test',
        login: 'baci_wallet_dva_provisioner',
        name: 'postgres',
        password: 'synthetic-only-password',
        port: 5432,
      },
    });
    expect(
      readWalletDvaProvisionerRuntime({
        ...validEnvironment,
        WALLET_DVA_PROVISIONER_DB_PASSWORD: '',
      })
    ).toBeNull();
  });
});
