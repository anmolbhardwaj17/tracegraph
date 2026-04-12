/**
 * Normalized types for multi-jurisdiction company data.
 * Every provider maps its response to these types.
 */

export interface CompanySearchResult {
  name: string;
  companyNumber: string;
  jurisdiction: string;
  status: string;
  incorporationDate: string | null;
  registryUrl: string;
  source: DataSource;
}

export interface CompanyProfile {
  name: string;
  companyNumber: string;
  jurisdiction: string;
  jurisdictionLabel: string;
  status: 'active' | 'dissolved' | 'liquidation' | 'administration' | 'unknown';
  incorporationDate: string | null;
  dissolutionDate: string | null;
  companyType: string | null;
  registeredAddress: string | null;
  sicCodes: string[];
  registryUrl: string;
  source: DataSource;
  dataDepth: DataDepth;
}

export interface Officer {
  name: string;
  role: string;
  appointedDate: string | null;
  resignedDate: string | null;
  nationality: string | null;
  dateOfBirth: { month?: number; year?: number } | null;
  source: DataSource;
}

export interface Filing {
  date: string;
  type: string;
  description: string;
  url: string | null;
}

export interface PSC {
  name: string;
  kind: string;
  naturesOfControl: string[];
  notifiedOn: string | null;
}

export type DataSource = 'companies-house' | 'opencorporates' | 'sec-edgar';
export type DataDepth = 'full' | 'moderate' | 'basic';

/**
 * Common interface all jurisdiction data providers must implement.
 */
export interface CompanyDataProvider {
  readonly source: DataSource;
  readonly dataDepth: DataDepth;

  searchCompanies(query: string, jurisdictionCode?: string): Promise<CompanySearchResult[]>;
  getCompanyProfile(companyId: string, jurisdictionCode?: string): Promise<CompanyProfile | null>;
  getCompanyOfficers(companyId: string, jurisdictionCode?: string): Promise<Officer[]>;

  // Optional — not all providers support these
  getCompanyFilings?(companyId: string, jurisdictionCode?: string): Promise<Filing[]>;
  getCompanyPSCs?(companyId: string): Promise<PSC[]>;
}
