import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiHeader, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InvestigationService } from '../investigation/investigation.service';
import { EntityResolutionService } from '../entity-resolution/entity-resolution.service';
import { ApiKeyGuard } from './api-key.guard';

@ApiTags('v1')
@ApiHeader({ name: 'X-API-Key', description: 'Your API key', required: true })
@UseGuards(ApiKeyGuard)
@Controller('api/v1')
export class V1Controller {
  constructor(
    private readonly investigations: InvestigationService,
    private readonly resolution: EntityResolutionService,
  ) {}

  @Post('investigate')
  @ApiOperation({ summary: 'Start a new investigation' })
  @ApiResponse({ status: 201, description: 'Investigation queued' })
  async investigate(@Body() body: { query: string; tier?: string }) {
    const inv = await this.investigations.create(body.query, (body.tier as any) || 'STANDARD');
    return { investigationId: inv.id, status: inv.status, tier: inv.tier };
  }

  @Get('investigate/:id')
  @ApiOperation({ summary: 'Get full investigation results' })
  @ApiResponse({ status: 200, description: 'Full investigation data' })
  async getInvestigation(@Param('id') id: string) {
    return this.investigations.findOne(id);
  }

  @Get('investigate/:id/findings')
  @ApiOperation({ summary: 'Get findings only' })
  @ApiResponse({ status: 200, description: 'Array of findings' })
  async getFindings(@Param('id') id: string) {
    const inv = await this.investigations.findOne(id);
    return { findings: inv.findings || [], riskScore: inv.riskScore };
  }

  @Post('screen')
  @ApiOperation({ summary: 'Quick sanctions/PEP screen (no full investigation)' })
  @ApiResponse({ status: 200, description: 'Screen results' })
  async screen(@Body() body: { name: string; type?: 'person' | 'company' }) {
    const matches = await this.resolution.quickScreen(body.name, body.type || 'person');
    return { query: body.name, type: body.type || 'person', matches };
  }
}
