/**
 * Business impact context for every finding type.
 * Attached to findings after emission so the frontend can show
 * actionable guidance alongside each finding.
 */

export interface FindingImpact {
  businessImpact: string;
  legalReference?: string;
  verificationSteps: string[];
}

const IMPACTS: Record<string, FindingImpact> = {
  SHELL_NETWORK: {
    businessImpact: 'Shell company indicators suggest this entity may exist primarily as a corporate vehicle rather than a trading business. Transacting with shell companies exposes you to fraud, money laundering, and regulatory penalties.',
    legalReference: 'Money Laundering Regulations 2017, Regulation 28 (Enhanced Due Diligence)',
    verificationSteps: [
      'Request evidence of trading activity: invoices, contracts, bank statements',
      'Verify the registered office is a real business premises, not a virtual address',
      'Check whether the company files full accounts or uses exemptions to minimise disclosure',
    ],
  },
  VIRTUAL_OFFICE_CLUSTER: {
    businessImpact: 'A high density of companies at one address, particularly a known virtual office, indicates the address is used for registration purposes only. Companies here may have no physical presence or genuine operations.',
    verificationSteps: [
      'Visit the registered address or use Street View to confirm it is a real office',
      'Ask the company for their actual operating address',
      'Check if the address appears on known virtual office provider lists',
    ],
  },
  DIRECTOR_NOMINEE_PATTERN: {
    businessImpact: 'This director shows patterns consistent with nominee directorship - they may not have genuine decision-making authority. The real controller may be hidden, making it impossible to verify who you are actually doing business with.',
    legalReference: 'Companies Act 2006, Section 251 (Shadow directors)',
    verificationSteps: [
      'Request to meet the director in person or via video call',
      'Ask them to explain the company business in their own words',
      'Check whether they are connected to a known formation agent service',
    ],
  },
  BRIDGE_PERSON: {
    businessImpact: 'This person connects otherwise separate clusters of companies. They may be a legitimate connector (e.g., an accountant or lawyer) or a coordinator linking related schemes. Their role should be understood before relying on any connected company.',
    verificationSteps: [
      'Determine the professional relationship - are they an advisor, director, or owner?',
      'Check if companies in both clusters have a legitimate business relationship',
      'Investigate whether the clusters share other connections beyond this person',
    ],
  },
  DIRECTOR_VELOCITY: {
    businessImpact: 'This director is appointed to and resigns from companies at an unusually high rate. This pattern is common among nominee directors and formation agent operatives who provide names for incorporation but have no real involvement.',
    legalReference: 'Companies Act 2006, Section 154 (requirement to have directors)',
    verificationSteps: [
      'Ask the director about their specific role and responsibilities at this company',
      'Check if the high-velocity pattern correlates with a known formation agent',
      'Verify the director has genuine knowledge of the company business',
    ],
  },
  DISQUALIFIED_DIRECTOR: {
    businessImpact: 'A disqualified director is legally prohibited from acting as a company director. If confirmed, this company may be operating illegally under the Company Directors Disqualification Act 1986, which carries criminal penalties. Any contracts signed by a disqualified person in a directorial capacity may be voidable.',
    legalReference: 'Company Directors Disqualification Act 1986, Section 13',
    verificationSteps: [
      'Verify identity match using full name and date of birth on the CH register',
      'Check the disqualification register directly at Companies House',
      'Consult legal counsel before proceeding with any transaction',
    ],
  },
  CIRCULAR_OWNERSHIP: {
    businessImpact: 'Circular ownership structures obscure who ultimately controls and benefits from the company. This makes it impossible to verify beneficial ownership as required by UK anti-money laundering regulations. Legitimate businesses rarely use circular structures.',
    legalReference: 'Money Laundering Regulations 2017, Regulation 28',
    verificationSteps: [
      'Request the company to explain the ownership structure and its purpose',
      'Ask for certified copies of share certificates at each layer',
      'Consider whether you can satisfy your own KYC/KYB obligations with this structure',
    ],
  },
  OWNERSHIP_OPACITY: {
    businessImpact: 'The beneficial ownership of this company is difficult to determine from public records. Opaque ownership is a primary risk indicator for money laundering, tax evasion, and sanctions circumvention. You may not be able to determine who you are actually transacting with.',
    legalReference: 'Economic Crime (Transparency and Enforcement) Act 2022',
    verificationSteps: [
      'Request a certified beneficial ownership declaration directly from the company',
      'Cross-reference with the PSC register at Companies House',
      'If corporate PSCs exist, trace the chain to identify the ultimate human owner',
    ],
  },
  MASS_INCORPORATION: {
    businessImpact: 'Multiple companies incorporated in a short window by the same director suggests coordinated creation of corporate vehicles. This is common in carousel fraud, VAT fraud, and money laundering schemes where companies are created in bulk for specific transactions.',
    verificationSteps: [
      'Check whether the companies share the same SIC codes and registered address',
      'Determine if the companies are part of a legitimate group structure',
      'Investigate the timeline of activity after incorporation',
    ],
  },
  MASS_DISSOLUTION: {
    businessImpact: 'Coordinated dissolution of multiple companies suggests deliberate winding up of a corporate structure, often to eliminate evidence or avoid creditors. This frequently follows regulatory scrutiny or enforcement action.',
    verificationSteps: [
      'Check for any HMRC or court enforcement actions around the dissolution dates',
      'Look for successor companies incorporated by the same directors after dissolution',
      'Review final accounts for any asset transfers before dissolution',
    ],
  },
  RAPID_DISSOLUTION: {
    businessImpact: 'A company that existed for less than 18 months was likely created for a single transaction or purpose and then discarded. While not always suspicious, this pattern is common in single-purpose fraud vehicles.',
    verificationSteps: [
      'Check what accounts were filed during the company short life',
      'Investigate whether the director created other short-lived companies',
      'Look for any charges or mortgages registered during the active period',
    ],
  },
  RESIGNATION_CLUSTER: {
    businessImpact: 'Multiple resignations in a short window may indicate directors distancing themselves from a company before an adverse event such as insolvency, fraud discovery, or regulatory action.',
    verificationSteps: [
      'Check the company financial health around the resignation dates',
      'Look for any news articles or court filings around the same period',
      'Investigate whether the resigning directors joined new companies shortly after',
    ],
  },
  COORDINATED_LIFECYCLE: {
    businessImpact: 'A coordinated create-and-destroy cycle is one of the strongest indicators of deliberate corporate vehicle recycling. This pattern is used in carousel fraud, invoice factoring fraud, and money laundering where companies are created, used for transactions, then dissolved to eliminate the evidence trail.',
    legalReference: 'Proceeds of Crime Act 2002; Fraud Act 2006',
    verificationSteps: [
      'Map the exact transactions that occurred during the active period',
      'Check for asset transfers between the companies in the cycle',
      'Report to the National Crime Agency if fraud is suspected',
    ],
  },
  SANCTIONS_PROXIMITY: {
    businessImpact: 'This entity matches or is closely connected to a sanctioned person or entity. Transacting with sanctioned parties is a criminal offence carrying unlimited fines and imprisonment. Even indirect connections through the corporate network create regulatory exposure.',
    legalReference: 'Sanctions and Anti-Money Laundering Act 2018',
    verificationSteps: [
      'Verify the identity match using all available identifiers (name, DOB, nationality)',
      'Check the OFSI consolidated list directly for the latest status',
      'Obtain legal advice before any transaction involving this entity',
    ],
  },
  HIGH_RISK_JURISDICTION: {
    businessImpact: 'This entity is registered in a jurisdiction known for opaque corporate registries, weak beneficial-owner disclosure, or historical use in concealment structures. Enhanced due diligence is required under UK regulations when dealing with entities in high-risk jurisdictions.',
    legalReference: 'Money Laundering Regulations 2017, Regulation 33 (Enhanced due diligence for high-risk countries)',
    verificationSteps: [
      'Apply enhanced due diligence measures as required by regulation',
      'Demand evidence of economic substance and real-world operations in that jurisdiction',
      'Verify the business rationale for incorporating in that jurisdiction',
    ],
  },
  FILING_HEALTH: {
    businessImpact: 'Persistent late or missing filings indicate a company that does not comply with its statutory obligations. This can precede insolvency, strike-off, or enforcement action. It also makes it impossible to assess the company financial health from public records.',
    legalReference: 'Companies Act 2006, Section 441 (duty to file accounts)',
    verificationSteps: [
      'Request the company latest management accounts directly',
      'Check if any compulsory strike-off notices have been issued',
      'Verify the company confirmation statement is up to date',
    ],
  },
  ACCOUNT_REGRESSION: {
    businessImpact: 'Stepping down from full accounts to micro-entity accounts reduces the financial information available to the public. While legal, this pattern may indicate deliberate reduction of transparency or an attempt to avoid disclosure thresholds.',
    verificationSteps: [
      'Compare the revenue/turnover thresholds for each accounts type',
      'Request full management accounts directly from the company',
      'Check if the regression coincides with changes in directorship or ownership',
    ],
  },
  DORMANT_CYCLING: {
    businessImpact: 'A company that oscillates between dormant and active status is being intermittently activated, potentially for transaction-specific purposes. This pattern is consistent with companies used as vehicles for specific deals then returned to dormancy.',
    verificationSteps: [
      'Examine what activity occurred during each active window',
      'Check for any charges, contracts, or property transactions during active periods',
      'Investigate whether the same director controls other cycling companies',
    ],
  },
  PHOENIX_COMPANY: {
    businessImpact: 'A phoenix company pattern - where one company dissolves and another incorporates immediately with the same director and address - is commonly used to shed liabilities including tax debts, employee claims, and supplier debts. Creditors of the predecessor company are left unpaid.',
    legalReference: 'Insolvency Act 1986, Section 216 (restriction on re-use of company names)',
    verificationSteps: [
      'Check the predecessor company for outstanding creditors or HMRC debts',
      'Verify whether Section 216 restrictions apply to the director',
      'Investigate whether assets were transferred between the companies at undervalue',
    ],
  },
  SHELF_COMPANY_PURCHASE: {
    businessImpact: 'Purchasing a dormant shelf company to acquire instant historical credibility is a known technique used to deceive credit agencies, banks, and business partners into believing a company has a long trading history.',
    verificationSteps: [
      'Check the director appointment dates against the company incorporation date',
      'Verify whether the company actually traded before the new directors arrived',
      'Request evidence of genuine commercial activity, not just filed dormant accounts',
    ],
  },
  NEW_COMPANY_HEAVY_CHARGES: {
    businessImpact: 'A newly formed company with registered charges is unusual. Companies typically build credit over time before taking on secured debt. Immediate charges may indicate the company was created specifically to take on debt obligations.',
    verificationSteps: [
      'Inspect each charge: who is the lender, what asset is secured',
      'Check whether the charges were created as part of a group restructuring',
      'Verify the company has genuine assets to secure against',
    ],
  },
  MASS_FORMATION_EVENT: {
    businessImpact: 'A single director appearing on many companies incorporated on the same day strongly suggests use of a formation agent or creation of templated corporate structures. These companies may exist on paper only.',
    verificationSteps: [
      'Check whether the director is linked to a known formation agent',
      'Verify whether each company has its own distinct business activity',
      'Look for shared addresses and SIC codes across the batch',
    ],
  },
  FILING_GAP_REACTIVATION: {
    businessImpact: 'A multi-year gap in filings followed by reactivation suggests a dormant company being repurposed. The new activity may be unrelated to the original business and the company history may be misleading.',
    verificationSteps: [
      'Check for ownership changes during the gap period',
      'Verify the current business activity matches the SIC codes',
      'Request an explanation for the filing gap',
    ],
  },
  SAME_SIC_CONFLICT: {
    businessImpact: 'A director serving on competing companies in the same industry creates a conflict of interest. They may be sharing confidential information, coordinating pricing, or operating a cartel arrangement.',
    legalReference: 'Competition Act 1998, Chapter I prohibition',
    verificationSteps: [
      'Determine whether the companies are genuinely competing or part of a group',
      'Check if the director has disclosed the conflict to both boards',
      'Review whether any non-compete agreements are in place',
    ],
  },
  INCESTUOUS_NETWORK: {
    businessImpact: 'A small group of people controlling many companies through circular appointments suggests a single decision-making unit disguised as separate entities. Treat the entire cluster as one risk exposure, not individual companies.',
    verificationSteps: [
      'Map the full extent of the network - all companies, all directors',
      'Check for cross-guarantees or inter-company loans',
      'Assess aggregate exposure rather than per-company exposure',
    ],
  },
  DUAL_SIDED_DIRECTOR: {
    businessImpact: 'A director sitting on both sides of a business relationship (e.g., buyer and supplier) creates a conflict of interest and potential for self-dealing. Related-party transactions should be scrutinised for market-rate pricing.',
    legalReference: 'Companies Act 2006, Section 177 (duty to declare interest in proposed transactions)',
    verificationSteps: [
      'Check whether the related-party relationship is disclosed in the accounts',
      'Review transaction terms for evidence of arm-length pricing',
      'Verify the director has declared their interest to both boards',
    ],
  },
  FORMATION_AGENT: {
    businessImpact: 'This entity is a known company formation service. Connections to formation agents are routine and not inherently suspicious - they simply indicate the company was professionally incorporated rather than by the founders directly.',
    verificationSteps: [
      'No action required - this is informational',
      'Focus due diligence on the beneficial owners, not the formation agent',
    ],
  },
  CROSS_INVESTIGATION: {
    businessImpact: 'This entity appeared in another investigation on TraceGraph. Repeat appearances across multiple corporate networks indicate a person or company that operates at the intersection of multiple risk structures.',
    verificationSteps: [
      'Review the findings from the related investigation',
      'Check whether the entity role is the same across investigations',
      'Assess cumulative risk exposure across all related networks',
    ],
  },
  FINANCIAL_DISTRESS: {
    businessImpact: 'Financial distress signals suggest this company may be unable to meet its obligations. Negative equity means liabilities exceed assets. Companies in financial distress are at higher risk of insolvency, which could leave you as an unpaid creditor.',
    legalReference: 'Insolvency Act 1986',
    verificationSteps: [
      'Request the latest management accounts and cash flow projections',
      'Check for any winding-up petitions at the High Court',
      'Consider requiring personal guarantees or upfront payment terms',
    ],
  },
};

/**
 * Attach impact context to each finding. Mutates the findings array.
 */
export function attachImpacts(findings: any[]): void {
  for (const f of findings) {
    const impact = IMPACTS[f.type];
    if (impact) {
      f.businessImpact = impact.businessImpact;
      f.legalReference = impact.legalReference;
      f.verificationSteps = impact.verificationSteps;
    }
  }
}
