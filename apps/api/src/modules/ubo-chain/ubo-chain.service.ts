import { Injectable, Logger } from '@nestjs/common';
import { CompaniesHouseService } from '../companies-house/companies-house.service';
import { ChainFlag, ChainNode, UboChain } from './ubo-chain.types';

const MAX_DEPTH = 5;
const DEEP_THRESHOLD = 4;
const MAX_PSCS_PER_COMPANY = 5;

const OFFSHORE_HINTS = [
  'british virgin islands', 'bvi', 'virgin islands',
  'cayman', 'cayman islands',
  'panama',
  'seychelles',
  'marshall islands',
  'belize',
  'bermuda',
  'bahamas',
  'mauritius',
  'jersey', 'guernsey', 'isle of man',
];

function midpointFromRange(s: string): number | null {
  const m = s.match(/(\d+)-to-(\d+)-percent/);
  if (m) return (parseInt(m[1], 10) + parseInt(m[2], 10)) / 2;
  if (/more-than-25-percent/.test(s)) return 25;
  if (/more-than-50-percent/.test(s)) return 50;
  if (/more-than-75-percent/.test(s)) return 75;
  return null;
}

function ownershipFromNatures(natures: string[] | undefined): number | undefined {
  if (!natures || natures.length === 0) return undefined;
  let best: number | undefined;
  for (const n of natures) {
    const v = midpointFromRange(n);
    if (v != null && (best == null || v > best)) best = v;
  }
  // Fallback for "right to appoint", "significant influence" etc — we conservatively
  // assume 25% to keep them visible without overstating.
  if (best == null && natures.some((n) => /significant-influence|right-to-appoint/.test(n))) {
    return 25;
  }
  return best;
}

function isOffshore(jurisdiction?: string): boolean {
  if (!jurisdiction) return false;
  const j = jurisdiction.toLowerCase();
  return OFFSHORE_HINTS.some((h) => j.includes(h));
}

function pscKind(p: any): 'company' | 'person' {
  const k = (p?.kind || '').toString().toLowerCase();
  if (k.includes('corporate-entity') || k.includes('legal-person')) return 'company';
  return 'person';
}

@Injectable()
export class UboChainService {
  private readonly logger = new Logger(UboChainService.name);

  constructor(private readonly ch: CompaniesHouseService) {}

  /**
   * Build all UBO ownership chains starting from `rootCompanyNumber`.
   * Returns one chain per *leaf* of the PSC tree (one per UBO, dead-end, or
   * cap-hit).
   *
   * Each chain is ordered with the UBO at index 0 and the root company at the
   * end of the path. effectiveOwnershipPct is the product of ownerships along
   * the path (e.g. 60% × 100% × 45% = 27%).
   */
  async buildChains(rootCompanyNumber: string, rootCompanyName: string): Promise<UboChain[]> {
    const chains: UboChain[] = [];
    const visited = new Set<string>();

    // Each frame represents "I'm currently inside `companyNumber` and the path
    // built so far is `pathDown` (root → here, top-down)."
    type Frame = {
      companyNumber: string;
      companyName: string;
      jurisdiction?: string;
      pathDown: ChainNode[];
      depth: number;
    };

    const rootNode: ChainNode = {
      level: 0,
      kind: 'company',
      name: rootCompanyName,
      companyNumber: rootCompanyNumber,
    };

    const stack: Frame[] = [
      {
        companyNumber: rootCompanyNumber,
        companyName: rootCompanyName,
        pathDown: [rootNode],
        depth: 0,
      },
    ];

    let chainSeq = 0;

    while (stack.length > 0) {
      const frame = stack.pop()!;
      const cycleKey = `${frame.companyNumber}@${frame.depth}`;
      if (visited.has(cycleKey)) {
        chains.push(makeChain(chainSeq++, rootCompanyNumber, rootCompanyName, frame.pathDown, ['CIRCULAR'], 'circular reference'));
        continue;
      }
      visited.add(cycleKey);

      let pscResp: any;
      try {
        pscResp = await this.ch.getPSC(frame.companyNumber);
      } catch (e: any) {
        // Couldn't resolve — emit a dead-end chain so the analyst sees it
        chains.push(
          makeChain(
            chainSeq++,
            rootCompanyNumber,
            rootCompanyName,
            frame.pathDown,
            ['DEAD_END'],
            `psc lookup failed: ${e?.message || 'unknown'}`,
          ),
        );
        continue;
      }

      const items = (pscResp?.items || []).slice(0, MAX_PSCS_PER_COMPANY);
      if (items.length === 0) {
        chains.push(
          makeChain(
            chainSeq++,
            rootCompanyNumber,
            rootCompanyName,
            frame.pathDown,
            ['DEAD_END'],
            'no PSCs filed',
          ),
        );
        continue;
      }

      for (const p of items) {
        if (p.ceased_on || p.ceased) continue;
        const kind = pscKind(p);
        const ownership = ownershipFromNatures(p.natures_of_control);
        const jurisdiction =
          p.identification?.country_registered ||
          p.country_of_residence ||
          undefined;

        // Attach ownership to the *parent* node (it's the "% of next-down it owns")
        const newPath = frame.pathDown.map((n, idx) =>
          idx === frame.pathDown.length - 1
            ? { ...n, ownershipPct: ownership, naturesOfControl: p.natures_of_control }
            : n,
        );

        const pscNode: ChainNode = {
          level: frame.depth + 1,
          kind,
          name: p.name || 'Unknown PSC',
          companyNumber: p.identification?.registration_number || undefined,
          jurisdiction,
        };

        const fullPath = [...newPath, pscNode];

        if (kind === 'person') {
          chains.push(
            makeChain(chainSeq++, rootCompanyNumber, rootCompanyName, fullPath, [], 'reached natural person'),
          );
          continue;
        }

        // Corporate PSC
        if (frame.depth + 1 >= MAX_DEPTH) {
          chains.push(
            makeChain(
              chainSeq++,
              rootCompanyNumber,
              rootCompanyName,
              fullPath,
              ['DEEP'],
              `depth cap (${MAX_DEPTH}) reached`,
            ),
          );
          continue;
        }

        // Try to recurse — only if we have a UK company number we can look up
        const childCompanyNumber = p.identification?.registration_number;
        const childIsUk =
          !p.identification?.country_registered ||
          /united kingdom|england|wales|scotland|northern ireland|gb/i.test(
            (p.identification?.country_registered || '').toString(),
          );

        if (!childCompanyNumber || !childIsUk) {
          // Foreign / unknown corporate — terminate chain here
          const flags: ChainFlag[] = [];
          if (isOffshore(jurisdiction)) flags.push('OFFSHORE');
          flags.push('DEAD_END');
          chains.push(
            makeChain(
              chainSeq++,
              rootCompanyNumber,
              rootCompanyName,
              fullPath,
              flags,
              jurisdiction ? `foreign entity in ${jurisdiction}` : 'foreign / unverifiable entity',
            ),
          );
          continue;
        }

        stack.push({
          companyNumber: childCompanyNumber,
          companyName: p.name || childCompanyNumber,
          jurisdiction,
          pathDown: fullPath,
          depth: frame.depth + 1,
        });
      }
    }

    // Final post-processing: compute effective ownership %, attach OFFSHORE/DEEP flags
    // by inspecting the full path.
    return chains.map((c) => finalize(c));
  }
}

function makeChain(
  seq: number,
  rootCompanyNumber: string,
  rootCompanyName: string,
  pathDown: ChainNode[],
  flags: ChainFlag[],
  terminationReason: string,
): UboChain {
  // path is currently top-down (root → UBO). We expose UBO-first (root at end)
  // because analysts read "X owns Y owns Z" from the human upward.
  const reversed = [...pathDown].reverse();
  return {
    id: `${rootCompanyNumber}-${seq}`,
    rootCompanyNumber,
    rootCompanyName,
    path: reversed,
    effectiveOwnershipPct: 0,
    flags: [...flags],
    terminationReason,
  };
}

function finalize(c: UboChain): UboChain {
  // Walk the reversed path and multiply ownership percentages.
  // Each node's ownershipPct represents what the *next-down* node holds in
  // the *next-down-down* node, originally encoded on the parent in the top-
  // down path. Since we reversed, ownershipPct on node[i+1] still applies to
  // node[i] holding node[i+1] — which is exactly the chain semantics we want.
  let pct: number | null = null;
  for (const n of c.path) {
    if (n.ownershipPct == null) continue;
    if (pct == null) pct = n.ownershipPct;
    else pct = (pct * n.ownershipPct) / 100;
  }
  c.effectiveOwnershipPct = Math.round((pct ?? 0) * 10) / 10;

  // Path-level flags
  const hasOffshore = c.path.some((n) => isOffshore(n.jurisdiction));
  if (hasOffshore && !c.flags.includes('OFFSHORE')) c.flags.push('OFFSHORE');
  if (c.path.length > DEEP_THRESHOLD + 1 && !c.flags.includes('DEEP')) c.flags.push('DEEP');

  return c;
}
