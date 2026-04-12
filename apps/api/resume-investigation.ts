/**
 * Resume a stuck investigation from RESOLVING stage.
 * Usage: npx ts-node resume-investigation.ts <investigation-id>
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { EntityResolutionService } from './src/modules/entity-resolution/entity-resolution.service';
import { SanctionsProximityService } from './src/modules/entity-resolution/proximity.service';
import { RiskScoringService } from './src/modules/risk-scoring/risk-scoring.service';
import { UboChainService } from './src/modules/ubo-chain/ubo-chain.service';
import { Repository } from 'typeorm';
import { Investigation } from './src/modules/investigation/entities/investigation.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

async function main() {
  const id = process.argv[2] || '9f68d93c-0a6e-48dc-9e5e-43537450b97f';
  console.log(`Resuming investigation ${id}...`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });

  const invRepo = app.get<Repository<Investigation>>(getRepositoryToken(Investigation));
  const resolution = app.get(EntityResolutionService);
  const proximity = app.get(SanctionsProximityService);
  const riskScoring = app.get(RiskScoringService);
  const uboChains = app.get(UboChainService);

  const inv = await invRepo.findOne({ where: { id } });
  if (!inv) { console.error('Investigation not found'); process.exit(1); }

  const companyNumber = inv.metadata?.companyNumber;
  const companyName = inv.metadata?.companyName || inv.query;
  console.log(`Company: ${companyName} (${companyNumber}), Status: ${inv.status}`);

  // UBO chains
  console.log('Building UBO chains...');
  let uboResult: any[] = [];
  try {
    uboResult = await uboChains.buildChains(companyNumber, companyName);
    console.log(`  ${uboResult.length} chain(s) built`);
  } catch (e: any) { console.warn(`  UBO failed: ${e.message}`); }

  // Resolution
  console.log('Running entity resolution...');
  await invRepo.update(id, { status: 'RESOLVING' });
  const resResult = await resolution.resolveInvestigation(id, {
    onProgress: (p: any) => {
      if (p.processed % 500 === 0) console.log(`  ${p.processed}/${p.total} screened, ${p.matches} matches`);
    },
  });
  console.log(`  Done: ${resResult.processed} screened, ${resResult.matches} matches`);

  // Proximity
  console.log('Computing sanctions proximity...');
  const proxResult = await proximity.compute(id);
  console.log(`  ${proxResult.scored} scored, ${proxResult.flagged} flagged`);

  // Scoring
  console.log('Running risk scoring...');
  await invRepo.update(id, { status: 'SCORING' });
  const riskResult = await riskScoring.run(id, (step, detail) => {
    console.log(`  ${step}${detail ? ': ' + detail : ''}`);
  });
  console.log(`  Risk score: ${riskResult.score}, ${riskResult.findings.length} findings`);

  // Complete
  const progress = inv.progress || {};
  await invRepo.update(id, {
    status: 'COMPLETE',
    completedAt: new Date(),
    progress: {
      ...progress,
      uboChains: uboResult,
      resolution: resResult,
      proximity: proxResult,
      riskScore: riskResult.score,
      riskClassification: riskResult.score >= 75 ? 'CRITICAL' : riskResult.score >= 50 ? 'HIGH' : riskResult.score >= 25 ? 'MEDIUM' : 'LOW',
      findings: riskResult.findings,
    } as any,
  });

  console.log(`\nInvestigation ${id} COMPLETE. Risk score: ${riskResult.score}`);
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
