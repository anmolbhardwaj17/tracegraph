export type InvestigationStatus = 'QUEUED' | 'FETCHING' | 'COMPLETE' | 'FAILED';

export interface CompanyDTO {
  companyNumber: string;
  name: string;
  status?: string;
  incorporationDate?: string;
  companyType?: string;
  jurisdiction?: string;
  sicCodes?: string[];
  address?: AddressDTO;
}

export interface AddressDTO {
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface OfficerDTO {
  id: string;
  name: string;
  role?: string;
  appointedOn?: string;
  resignedOn?: string;
  nationality?: string;
  dateOfBirthMonth?: number;
  dateOfBirthYear?: number;
  otherAppointments?: { companyNumber: string; companyName: string; role?: string }[];
}

export interface PSCDTO {
  id: string;
  name: string;
  kind?: string;
  naturesOfControl?: string[];
  notifiedOn?: string;
}

export interface InvestigationResult {
  id: string;
  query: string;
  status: InvestigationStatus;
  createdAt: string;
  completedAt?: string;
  company?: CompanyDTO;
  officers?: OfficerDTO[];
  psc?: PSCDTO[];
  error?: string;
}
