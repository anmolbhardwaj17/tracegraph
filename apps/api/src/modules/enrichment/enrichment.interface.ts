/**
 * Enrichment system — scrapes and aggregates data from multiple public sources
 * to deeply populate investigation graphs with people, locations, subsidiaries, and UBO.
 */

export interface EnrichedCompanyData {
  /** Headquarters / registered office locations */
  locations: EnrichedLocation[];
  /** Key people: executives, board members, founders */
  people: EnrichedPerson[];
  /** Subsidiaries and related companies */
  subsidiaries: EnrichedSubsidiary[];
  /** Parent / ultimate beneficial owner chain */
  parentChain: EnrichedOwner[];
  /** Industry / sector info */
  industry: string | null;
  /** Revenue (latest, USD) */
  revenue: string | null;
  /** Website */
  website: string | null;
  /** Founded date */
  foundedDate: string | null;
  /** Number of employees */
  employeeCount: string | null;
  /** Source of enrichment */
  source: string;
}

export interface EnrichedLocation {
  label: string;
  address: string;
  type: 'headquarters' | 'registered' | 'branch' | 'subsidiary';
  country: string | null;
  lat?: number;
  lng?: number;
}

export interface EnrichedPerson {
  name: string;
  role: string;
  type: 'executive' | 'board' | 'founder' | 'officer';
  source: string;
}

export interface EnrichedSubsidiary {
  name: string;
  jurisdiction: string | null;
  ownershipPct: string | null;
  status: string | null;
  source: string;
}

export interface EnrichedOwner {
  name: string;
  jurisdiction: string | null;
  relationship: string;
  level: number;
  source: string;
}

export interface Enricher {
  readonly name: string;
  /** Which jurisdictions this enricher supports. Empty = all. */
  readonly supportedJurisdictions: string[];
  /**
   * Enrich a company. Returns partial data — will be merged.
   * @param companyName  Display name
   * @param companyId    Registry ID / CIK / LEI
   * @param jurisdiction Two-letter code
   */
  enrich(companyName: string, companyId: string, jurisdiction: string): Promise<Partial<EnrichedCompanyData>>;
}
