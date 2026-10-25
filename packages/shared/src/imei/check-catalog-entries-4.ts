import { catalogEntry } from './check-catalog-types';

export const IMEI_CHECK_CATALOG_PART_4 = {
  verizonDeviceStatus: catalogEntry(
    'Verizon USA device status',
    'Check advertised clean, blocked and unpaid status for Verizon USA.',
    'finance',
    ['all'],
    ['smartphone'],
    []
  ),
  attStatus: catalogEntry(
    'AT&T USA device status',
    'Check the device status reported for AT&T USA; finance coverage requires response verification.',
    'finance',
    ['all'],
    ['smartphone'],
    ['attFinance']
  ),
  verizonFinance: catalogEntry(
    'Verizon USA finance check',
    'Check the finance status advertised for Verizon USA.',
    'finance',
    ['all'],
    ['smartphone'],
    ['verizonFinance']
  ),
  verizonLostStatus: catalogEntry(
    'Verizon lost or clean status',
    'Check whether Verizon records mark the device as clean or lost.',
    'blacklist',
    ['all'],
    ['smartphone'],
    []
  ),
  xfinityEligibility: catalogEntry(
    'Xfinity unlock eligibility',
    'Check whether the device meets the advertised Xfinity unlock eligibility rules; no unlock is performed.',
    'finance',
    ['all'],
    ['smartphone'],
    ['xfinityFinance']
  ),
  zteDetails: catalogEntry(
    'ZTE details & warranty',
    'Review advertised ZTE model, carrier, warranty, activation and production details.',
    'details',
    ['zte'],
    ['smartphone'],
    []
  ),
  xiaomiCodeConversion: catalogEntry(
    'Xiaomi lock-code lookup',
    'Resolve a Xiaomi lock code into an IMEI and advertised clean or lost status.',
    'advanced',
    ['xiaomi'],
    ['smartphone'],
    []
  ),
  xiaomiDetails: catalogEntry(
    'Xiaomi device details',
    'Identify Xiaomi device information from its IMEI.',
    'details',
    ['xiaomi'],
    ['smartphone'],
    []
  ),
  xiaomiLostStatus: catalogEntry(
    'Xiaomi account & lost status',
    'Check advertised Find Device, country and clean or lost status; delivery can take hours.',
    'ownership',
    ['xiaomi'],
    ['smartphone'],
    ['miLostPro']
  ),
  xiaomiAccountLock: catalogEntry(
    'Xiaomi account-lock status',
    'Check advertised Xiaomi account on or off status using its lock code.',
    'ownership',
    ['xiaomi'],
    ['smartphone'],
    ['miLock']
  ),
  motorolaDetails: catalogEntry(
    'Motorola device details',
    'Identify the Motorola device information available from its IMEI.',
    'details',
    ['motorola'],
    ['smartphone'],
    []
  ),
  orangeContract: catalogEntry(
    'Orange Romania contract status',
    'Check the contract status advertised for Orange Romania.',
    'finance',
    ['all'],
    ['smartphone'],
    []
  ),
  asusWarranty: catalogEntry(
    'ASUS warranty check',
    'Review advertised ASUS ROG phone or graphics-card warranty coverage.',
    'history',
    ['asus'],
    ['smartphone', 'graphics-card'],
    []
  ),
  tmobilePaidEligibility: catalogEntry(
    'T-Mobile fully-paid eligibility',
    'Check the advertised T-Mobile fully-paid eligibility; no unlock is performed.',
    'finance',
    ['all'],
    ['smartphone'],
    []
  ),
  cricketEligibility: catalogEntry(
    'Cricket unlock eligibility',
    'Check advertised Cricket unlock eligibility; no unlock is performed.',
    'finance',
    ['all'],
    ['smartphone'],
    []
  ),
  spectrumEligibility: catalogEntry(
    'Spectrum iPhone eligibility',
    'Check advertised Spectrum iPhone eligibility; no unlock is performed.',
    'finance',
    ['apple'],
    ['smartphone'],
    []
  ),
  metroStatus: catalogEntry(
    'Metro by T-Mobile device status',
    'Check the advertised MetroPCS USA device status.',
    'finance',
    ['all'],
    ['smartphone'],
    []
  ),
  verizonEligibility: catalogEntry(
    'Verizon unlock eligibility',
    'Check advertised Verizon unlock eligibility; no unlock is performed.',
    'finance',
    ['all'],
    ['smartphone'],
    []
  ),
} as const;
