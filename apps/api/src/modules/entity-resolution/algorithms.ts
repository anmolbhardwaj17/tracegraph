/** Name normalization: lower, trim, strip titles, normalize whitespace, drop punctuation. */
const TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'dame', 'lord', 'lady',
  'prof', 'professor', 'rev', 'hon', 'capt', 'col', 'gen',
]);

export function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[.,'"`]/g, ' ')
    .replace(/[^a-z\s\-]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok && !TITLES.has(tok.replace(/\.$/, '')))
    .join(' ')
    .trim();
}

/**
 * Simplified Double Metaphone — produces a phonetic key.
 * Not a full DM implementation but covers the common Western-name patterns
 * used for cross-source person matching.
 */
export function metaphone(name: string): string {
  if (!name) return '';
  let s = name.toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return '';

  // Common prefix simplifications
  s = s.replace(/^KN/, 'N').replace(/^GN/, 'N').replace(/^PN/, 'N').replace(/^WR/, 'R').replace(/^PS/, 'S');

  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1] || '';
    const prev = out[out.length - 1] || '';
    let code = '';
    switch (c) {
      case 'A': case 'E': case 'I': case 'O': case 'U':
        if (i === 0) code = c; break;
      case 'B': code = (i === s.length - 1 && prev === 'M') ? '' : 'B'; break;
      case 'C':
        if (next === 'H') { code = 'X'; i++; }
        else if (next === 'I' || next === 'E' || next === 'Y') code = 'S';
        else code = 'K';
        break;
      case 'D':
        if (next === 'G' && /[IEY]/.test(s[i + 2] || '')) { code = 'J'; i += 2; }
        else code = 'T';
        break;
      case 'F': code = 'F'; break;
      case 'G':
        if (next === 'H') { i++; code = ''; }
        else if (next === 'N') { code = 'N'; i++; }
        else if (/[IEY]/.test(next)) code = 'J';
        else code = 'K';
        break;
      case 'H':
        if (i > 0 && /[AEIOU]/.test(prev) && !/[AEIOU]/.test(next)) code = '';
        else code = 'H';
        break;
      case 'J': code = 'J'; break;
      case 'K': code = (prev === 'C') ? '' : 'K'; break;
      case 'L': code = 'L'; break;
      case 'M': code = 'M'; break;
      case 'N': code = 'N'; break;
      case 'P': if (next === 'H') { code = 'F'; i++; } else code = 'P'; break;
      case 'Q': code = 'K'; break;
      case 'R': code = 'R'; break;
      case 'S':
        if (next === 'H') { code = 'X'; i++; }
        else code = 'S';
        break;
      case 'T':
        if (next === 'H') { code = '0'; i++; }
        else code = 'T';
        break;
      case 'V': code = 'F'; break;
      case 'W': code = /[AEIOU]/.test(next) ? 'W' : ''; break;
      case 'X': code = 'KS'; break;
      case 'Y': code = /[AEIOU]/.test(next) ? 'Y' : ''; break;
      case 'Z': code = 'S'; break;
    }
    if (code && code !== prev) out += code;
  }
  return out.slice(0, 6);
}

/** Jaro distance. */
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (!len1 || !len2) return 0;
  const matchDist = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const m1 = new Array(len1).fill(false);
  const m2 = new Array(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - matchDist);
    const hi = Math.min(len2 - 1, i + matchDist);
    for (let j = lo; j <= hi; j++) {
      if (m2[j]) continue;
      if (s1[i] !== s2[j]) continue;
      m1[i] = true;
      m2[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < len1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  t /= 2;
  return (matches / len1 + matches / len2 + (matches - t) / matches) / 3;
}

/** Jaro-Winkler with default p=0.1, max prefix 4. */
export function jaroWinkler(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  const j = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}
