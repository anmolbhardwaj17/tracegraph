import { Controller, Get, Param, Query } from '@nestjs/common';
import { InsightsService, InsightTopic } from './insights.service';

@Controller('investigations')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get(':id/insights')
  async get(@Param('id') id: string, @Query('topic') topic?: string) {
    const validTopics: InsightTopic[] = ['overview', 'findings', 'entities'];
    const t: InsightTopic = validTopics.includes(topic as InsightTopic)
      ? (topic as InsightTopic)
      : 'overview';
    const insights = await this.insights.generate(id, t);
    return { insights, topic: t };
  }
}
