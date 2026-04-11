/**
 * Known UK company formation agents. These entities appear in almost every
 * corporate network because they incorporate companies on behalf of clients.
 * They are NOT interesting for investigation purposes and should be dimmed,
 * filtered, or excluded from anomaly scoring.
 */
export interface FormationAgent {
  name: string;
  companyNumber?: string;
}

export const FORMATION_AGENTS: FormationAgent[] = [
  { name: 'SWIFT INCORPORATIONS LIMITED', companyNumber: '01945937' },
  { name: 'SWIFT FORMATIONS LIMITED', companyNumber: '04733579' },
  { name: 'COMPANIES MADE SIMPLE GROUP LIMITED' },
  { name: 'COMPANIES MADE SIMPLE LIMITED' },
  { name: '1ST FORMATIONS LIMITED' },
  { name: 'RAPID FORMATIONS LIMITED' },
  { name: 'YOUR COMPANY FORMATIONS LLP' },
  { name: 'QUALITY COMPANY FORMATIONS LIMITED' },
  { name: 'SEED FORMATIONS LIMITED' },
  { name: 'COMPANIES HOUSE DIRECT LIMITED' },
  { name: 'JORDANS LIMITED' },
  { name: 'JORDANS FORMATIONS LIMITED' },
  { name: 'THE FORMATION COMPANY LIMITED' },
  { name: 'INCORPORATE LIMITED' },
  { name: 'DUPORT ASSOCIATES LIMITED' },
];

/** Normalise for matching: uppercase, strip punctuation. */
function norm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

const AGENT_NAMES = new Set(FORMATION_AGENTS.map((a) => norm(a.name)));
const AGENT_NUMBERS = new Set(
  FORMATION_AGENTS.filter((a) => a.companyNumber).map((a) => a.companyNumber!),
);

export function isFormationAgent(name?: string, companyNumber?: string): boolean {
  if (companyNumber && AGENT_NUMBERS.has(companyNumber)) return true;
  if (name && AGENT_NAMES.has(norm(name))) return true;
  if (name) {
    const n = norm(name);
    return n.includes('FORMATION') && (n.includes('LIMITED') || n.includes('LLP') || n.includes('LTD'));
  }
  return false;
}
