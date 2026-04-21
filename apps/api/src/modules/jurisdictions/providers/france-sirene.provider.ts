import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  CompanyDataProvider, CompanySearchResult, CompanyProfile, Officer,
  DataSource, DataDepth,
} from '../data-provider.interface';

/**
 * France Company Provider — uses recherche-entreprises.api.gouv.fr
 *
 * FREE, no API key needed. French government open data.
 * Data: SIREN, company profile, directors (up to 15), revenue,
 * address with GPS coordinates, employee count, legal form, activity code.
 *
 * This is the richest free company API in the EU.
 */

const API_BASE = 'https://recherche-entreprises.api.gouv.fr';
const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

// French legal form codes → labels
const LEGAL_FORMS: Record<string, string> = {
  '1000': 'Entrepreneur individuel', '5498': 'EURL',
  '5710': 'SAS', '5720': 'SASU', '5800': 'SE (Societas Europaea)',
  '5599': 'SA conseil administration', '5699': 'SA directoire',
  '5505': 'SA (cotee)', '6540': 'SARL',
};

@Injectable()
export class FranceSireneProvider implements CompanyDataProvider {
  private readonly logger = new Logger(FranceSireneProvider.name);
  readonly source: DataSource = 'opencorporates';
  readonly dataDepth: DataDepth = 'moderate';

  async searchCompanies(query: string): Promise<CompanySearchResult[]> {
    return cached(`france:search:${query.toLowerCase()}`, async () => {
      try {
        const res = await axios.get(`${API_BASE}/search`, {
          params: { q: query, page: 1, per_page: 15 },
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          timeout: 10000,
        });

        return (res.data?.results || []).map((r: any) => ({
          name: r.nom_complet || r.nom_raison_sociale || query,
          companyNumber: r.siren,
          jurisdiction: 'fr',
          status: r.etat_administratif === 'A' ? 'active' : 'dissolved',
          incorporationDate: r.date_creation || r.siege?.date_creation || null,
          registryUrl: `https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}`,
          source: 'opencorporates' as DataSource,
        }));
      } catch (e: any) {
        this.logger.warn(`France search failed: ${e?.message}`);
        return [];
      }
    });
  }

  async getCompanyProfile(siren: string): Promise<CompanyProfile | null> {
    return cached(`france:profile:${siren}`, async () => {
      try {
        const res = await axios.get(`${API_BASE}/search`, {
          params: { q: siren, page: 1, per_page: 1 },
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          timeout: 10000,
        });

        const r = res.data?.results?.[0];
        if (!r) return null;

        const siege = r.siege || {};
        const address = siege.adresse || [siege.libelle_voie, siege.code_postal, siege.libelle_commune].filter(Boolean).join(', ');

        return {
          name: r.nom_complet || r.nom_raison_sociale || siren,
          companyNumber: r.siren,
          jurisdiction: 'fr',
          jurisdictionLabel: 'France',
          status: r.etat_administratif === 'A' ? 'active' : 'dissolved',
          incorporationDate: r.date_creation || siege.date_creation || null,
          dissolutionDate: siege.date_fermeture || null,
          companyType: LEGAL_FORMS[r.nature_juridique] || r.nature_juridique || null,
          registeredAddress: address || null,
          sicCodes: siege.activite_principale ? [siege.activite_principale] : [],
          registryUrl: `https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}`,
          source: 'opencorporates' as DataSource,
          dataDepth: 'moderate' as DataDepth,
          // Extra fields for enrichment
          ...({
            latitude: siege.latitude ? parseFloat(siege.latitude) : null,
            longitude: siege.longitude ? parseFloat(siege.longitude) : null,
            employeeCount: r.tranche_effectif_salarie || null,
            categoryEntreprise: r.categorie_entreprise || null,
            revenue: r.finances ? (Object.values(r.finances as Record<string, any>)[0] as any)?.ca : null,
            netIncome: r.finances ? (Object.values(r.finances as Record<string, any>)[0] as any)?.resultat_net : null,
            directors: (r.dirigeants || []).map((d: any) => ({
              name: [d.prenom, d.nom].filter(Boolean).join(' '),
              role: d.qualite || 'Director',
            })),
          } as any),
        };
      } catch (e: any) {
        this.logger.warn(`France profile failed for ${siren}: ${e?.message}`);
        return null;
      }
    });
  }

  async getCompanyOfficers(siren: string): Promise<Officer[]> {
    return cached(`france:officers:${siren}`, async () => {
      try {
        const res = await axios.get(`${API_BASE}/search`, {
          params: { q: siren, page: 1, per_page: 1 },
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          timeout: 10000,
        });

        const r = res.data?.results?.[0];
        if (!r) return [];

        return (r.dirigeants || []).map((d: any) => ({
          name: [d.prenom, d.nom].filter(Boolean).join(' ') || 'Unknown',
          role: d.qualite || 'Dirigeant',
          appointedDate: null,
          resignedDate: null,
          nationality: d.nationalite || 'French',
          dateOfBirth: null,
          source: 'opencorporates' as DataSource,
        }));
      } catch (e: any) {
        this.logger.warn(`France officers failed: ${e?.message}`);
        return [];
      }
    });
  }
}
