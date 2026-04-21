import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { WatchlistService } from './watchlist.service';
import { WatchlistMonitorService } from './watchlist-monitor.service';

@Controller('api/watchlist')
export class WatchlistController {
  constructor(
    private readonly svc: WatchlistService,
    private readonly monitor: WatchlistMonitorService,
  ) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  add(@Body() body: { companyNumber: string; companyName: string; investigationId?: string; riskScore?: number }) {
    return this.svc.add(body.companyNumber, body.companyName, body.investigationId, body.riskScore);
  }

  @Get(':companyNumber')
  async check(@Param('companyNumber') companyNumber: string) {
    const items = await this.svc.list();
    const item = items.find((i) => i.companyNumber === companyNumber);
    return { watched: !!item, item: item || null };
  }

  @Delete(':companyNumber')
  remove(@Param('companyNumber') companyNumber: string) {
    return this.svc.remove(companyNumber);
  }

  // ─── Alert Endpoints ───

  /** GET /api/watchlist/alerts — get recent alerts */
  @Get('alerts/list')
  async getAlerts(@Query('unread') unread?: string) {
    return this.monitor.getAlerts({ unreadOnly: unread === 'true', limit: 50 });
  }

  /** GET /api/watchlist/alerts/count — unread count */
  @Get('alerts/count')
  async getAlertCount() {
    return { count: await this.monitor.getUnreadCount() };
  }

  /** PUT /api/watchlist/alerts/:id/read — mark as read */
  @Put('alerts/:id/read')
  async markRead(@Param('id') id: string) {
    await this.monitor.markRead(id);
    return { ok: true };
  }

  /** PUT /api/watchlist/alerts/:id/dismiss — dismiss */
  @Put('alerts/:id/dismiss')
  async dismiss(@Param('id') id: string) {
    await this.monitor.dismiss(id);
    return { ok: true };
  }

  /** POST /api/watchlist/monitor — trigger monitoring manually */
  @Post('monitor')
  async runMonitoring() {
    return this.monitor.runMonitoring();
  }
}
