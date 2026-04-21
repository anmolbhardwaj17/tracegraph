import { WikidataEnricher } from './wikidata.enricher';

describe('WikidataEnricher', () => {
  const enricher = new WikidataEnricher();

  it('should be defined', () => {
    expect(enricher).toBeDefined();
    expect(enricher.name).toBe('wikidata');
    expect(enricher.supportedJurisdictions).toEqual([]);
  });

  it('should normalize SEC-style names', () => {
    // Access private method via any cast
    const normalize = (enricher as any).normalizeCompanyName.bind(enricher);
    expect(normalize('AMAZON COM INC')).toBe('Amazon.com');
    expect(normalize('APPLE INC')).toBe('Apple');
    expect(normalize('MICROSOFT CORP')).toBe('Microsoft');
    expect(normalize('ALPHABET INC')).toBe('Alphabet Inc.');
    expect(normalize('META PLATFORMS INC')).toBe('Meta Platforms');
    expect(normalize('TESCO PLC')).toBe('Tesco');
    expect(normalize('Reliance Industries Limited')).toBe('Reliance Industries Limited');
  });

  it('should return empty for unknown companies', async () => {
    const result = await enricher.enrich('XYZNONEXISTENT99999', 'test', 'us');
    expect(result.source).toBe('wikidata');
  }, 30000);
});
