import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/guards/jwt-auth.guard';
import { PipelineService } from './pipeline.service';

@ApiTags('Pipeline')
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get()
  @Public()
  async list(@Query('stage') stage?: string, @Query('priority') priority?: string, @Query('owner') owner?: string) {
    return this.pipeline.listPipeline({ stage, priority, owner });
  }

  @Get('kanban')
  @Public()
  async kanban() {
    return this.pipeline.kanban();
  }

  @Get('stats')
  @Public()
  async stats() {
    return this.pipeline.stats();
  }

  @Get(':id/detail')
  @Public()
  async detail(@Param('id') id: string) {
    const data = await this.pipeline.getDealDetail(id);
    if (!data) return { error: 'Not found' };
    return data;
  }

  @Put(':id/stage')
  @Public()
  async updateStage(@Param('id') id: string, @Body() body: { stage: string; actorName?: string }) {
    return this.pipeline.updateStage(id, body.stage as any, body.actorName);
  }

  @Put(':id/priority')
  @Public()
  async updatePriority(@Param('id') id: string, @Body() body: { priority: string; actorName?: string }) {
    return this.pipeline.updatePriority(id, body.priority as any, body.actorName);
  }

  @Put(':id/deal-size')
  @Public()
  async updateDealSize(@Param('id') id: string, @Body() body: { sizeEstimate: number; actorName?: string }) {
    return this.pipeline.updateDealSize(id, body.sizeEstimate, body.actorName);
  }

  @Put(':id/owner')
  @Public()
  async updateOwner(@Param('id') id: string, @Body() body: { ownerName: string; actorName?: string }) {
    return this.pipeline.updateOwner(id, body.ownerName, body.actorName);
  }

  @Post(':id/notes')
  @Public()
  async addNote(@Param('id') id: string, @Body() body: { body: string; authorName?: string }) {
    if (!body.body?.trim()) return { error: 'Note body is required' };
    return this.pipeline.addNote(id, body.body.trim(), body.authorName);
  }

  @Get(':id/notes')
  @Public()
  async getNotes(@Param('id') id: string) {
    return this.pipeline.getNotes(id);
  }

  @Get(':id/activity')
  @Public()
  async getActivity(@Param('id') id: string) {
    return this.pipeline.getActivity(id);
  }
}
