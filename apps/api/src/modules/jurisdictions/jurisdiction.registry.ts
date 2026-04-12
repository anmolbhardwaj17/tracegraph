import { DataSource, DataDepth } from './data-provider.interface';

export interface JurisdictionConfig {
  code: string;
  label: string;
  provider: DataSource;
  depth: DataDepth;
  flag: string;
  /** Secondary provider for additional data (e.g. SEC for US public companies) */
  secondaryProvider?: DataSource;
}

const JURISDICTIONS: Record<string, JurisdictionConfig> = {
  gb: { code: 'gb', label: 'United Kingdom', provider: 'companies-house', depth: 'full', flag: 'GB' },
  us: { code: 'us', label: 'United States', provider: 'opencorporates', depth: 'basic', flag: 'US', secondaryProvider: 'sec-edgar' },
  de: { code: 'de', label: 'Germany', provider: 'opencorporates', depth: 'basic', flag: 'DE' },
  fr: { code: 'fr', label: 'France', provider: 'opencorporates', depth: 'basic', flag: 'FR' },
  nl: { code: 'nl', label: 'Netherlands', provider: 'opencorporates', depth: 'basic', flag: 'NL' },
  ie: { code: 'ie', label: 'Ireland', provider: 'opencorporates', depth: 'basic', flag: 'IE' },
  lu: { code: 'lu', label: 'Luxembourg', provider: 'opencorporates', depth: 'basic', flag: 'LU' },
  ch: { code: 'ch', label: 'Switzerland', provider: 'opencorporates', depth: 'basic', flag: 'CH' },
  sg: { code: 'sg', label: 'Singapore', provider: 'opencorporates', depth: 'basic', flag: 'SG' },
  hk: { code: 'hk', label: 'Hong Kong', provider: 'opencorporates', depth: 'basic', flag: 'HK' },
  au: { code: 'au', label: 'Australia', provider: 'opencorporates', depth: 'basic', flag: 'AU' },
  ca: { code: 'ca', label: 'Canada', provider: 'opencorporates', depth: 'basic', flag: 'CA' },
  in: { code: 'in', label: 'India', provider: 'opencorporates', depth: 'basic', flag: 'IN' },
  jp: { code: 'jp', label: 'Japan', provider: 'opencorporates', depth: 'basic', flag: 'JP' },
  ae: { code: 'ae', label: 'UAE', provider: 'opencorporates', depth: 'basic', flag: 'AE' },
  ky: { code: 'ky', label: 'Cayman Islands', provider: 'opencorporates', depth: 'basic', flag: 'KY' },
  vg: { code: 'vg', label: 'British Virgin Islands', provider: 'opencorporates', depth: 'basic', flag: 'VG' },
  je: { code: 'je', label: 'Jersey', provider: 'opencorporates', depth: 'basic', flag: 'JE' },
  gg: { code: 'gg', label: 'Guernsey', provider: 'opencorporates', depth: 'basic', flag: 'GG' },
  im: { code: 'im', label: 'Isle of Man', provider: 'opencorporates', depth: 'basic', flag: 'IM' },
  pa: { code: 'pa', label: 'Panama', provider: 'opencorporates', depth: 'basic', flag: 'PA' },
};

const DEFAULT_CONFIG: JurisdictionConfig = {
  code: 'unknown',
  label: 'Unknown',
  provider: 'opencorporates',
  depth: 'basic',
  flag: '??',
};

export function getJurisdiction(code: string): JurisdictionConfig {
  return JURISDICTIONS[code.toLowerCase()] || { ...DEFAULT_CONFIG, code: code.toLowerCase(), label: code.toUpperCase() };
}

export function getAllJurisdictions(): JurisdictionConfig[] {
  return Object.values(JURISDICTIONS);
}

export function getJurisdictionChoices(): Array<{ value: string; label: string; flag: string }> {
  const top = ['gb', 'us', 'de', 'fr', 'nl', 'ie', 'ch', 'sg', 'hk', 'au', 'ca', 'in'];
  return top.map((code) => {
    const j = JURISDICTIONS[code]!;
    return { value: j.code, label: j.label, flag: j.flag };
  });
}
