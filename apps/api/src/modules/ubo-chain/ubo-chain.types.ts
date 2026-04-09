export type ChainNodeKind = 'company' | 'person' | 'unknown';

export interface ChainNode {
  level: number;
  kind: ChainNodeKind;
  name: string;
  companyNumber?: string;
  jurisdiction?: string;
  /** Ownership % held by this node *over the next node down the chain*. */
  ownershipPct?: number;
  /** The raw natures_of_control strings, for display. */
  naturesOfControl?: string[];
}

export type ChainFlag = 'DEEP' | 'OFFSHORE' | 'DEAD_END' | 'CIRCULAR';

export interface UboChain {
  id: string;
  rootCompanyNumber: string;
  rootCompanyName: string;
  /** UBO at index 0, root company at the last index. */
  path: ChainNode[];
  /** Product of ownershipPct values along the path, in [0,100]. */
  effectiveOwnershipPct: number;
  flags: ChainFlag[];
  /** Why we stopped walking (e.g. "found person", "max depth", "lookup failed"). */
  terminationReason: string;
}
