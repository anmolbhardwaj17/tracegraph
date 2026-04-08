const ABBREV: Record<string, string> = {
  rd: 'road',
  st: 'street',
  ln: 'lane',
  ave: 'avenue',
  av: 'avenue',
  blvd: 'boulevard',
  hwy: 'highway',
  pkwy: 'parkway',
  ct: 'court',
  dr: 'drive',
  pl: 'place',
  sq: 'square',
  ter: 'terrace',
  cres: 'crescent',
  gdns: 'gardens',
};

export function normalizeAddress(parts: {
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  postalCode?: string;
  country?: string;
}): string {
  const raw = [parts.addressLine1, parts.addressLine2, parts.locality, parts.postalCode, parts.country]
    .filter(Boolean)
    .join(' ');
  return raw
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((tok) => ABBREV[tok.replace(/[^a-z]/g, '')] || tok)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
