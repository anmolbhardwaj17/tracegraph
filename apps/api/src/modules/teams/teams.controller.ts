import { Body, Controller, Delete, Get, Param, Post, Put, Req, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/guards/jwt-auth.guard';
import { TeamsService } from './teams.service';

@ApiTags('Teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly svc: TeamsService) {}

  /** POST /api/teams — create a new team */
  @Post()
  async create(@Body() body: { name: string }, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) return { error: 'Authentication required' };
    return this.svc.createTeam(body.name, userId);
  }

  /** GET /api/teams/mine — teams the current user belongs to */
  @Get('mine')
  async mine(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) return [];
    return this.svc.getUserTeams(userId);
  }

  /** GET /api/teams/:id — team detail with members */
  @Get(':id')
  async getTeam(@Param('id') id: string) {
    return this.svc.getTeam(id);
  }

  /** GET /api/teams/:id/members */
  @Get(':id/members')
  async members(@Param('id') id: string) {
    return this.svc.getMembers(id);
  }

  /** POST /api/teams/:id/invite */
  @Post(':id/invite')
  async invite(@Param('id') id: string, @Body() body: { email: string; role?: 'admin' | 'member' | 'viewer' }) {
    return this.svc.inviteMember(id, body.email, body.role || 'member');
  }

  /** DELETE /api/teams/:id/members/:memberId */
  @Delete(':id/members/:memberId')
  async removeMember(@Param('id') id: string, @Param('memberId') memberId: string) {
    await this.svc.removeMember(id, memberId);
    return { ok: true };
  }

  /** PUT /api/teams/:id/members/:memberId/role */
  @Put(':id/members/:memberId/role')
  async updateRole(@Param('id') id: string, @Param('memberId') memberId: string, @Body() body: { role: 'admin' | 'member' | 'viewer' }) {
    await this.svc.updateMemberRole(id, memberId, body.role);
    return { ok: true };
  }

  /** GET /api/teams/:id/investigations — all investigations for a team */
  @Get(':id/investigations')
  async investigations(@Param('id') id: string) {
    return this.svc.getTeamInvestigations(id);
  }
}

@ApiTags('Sharing')
@Controller('shared')
export class SharingController {
  constructor(private readonly svc: TeamsService) {}

  /** GET /api/shared/:token — public read-only investigation view */
  @Get(':token')
  @Public()
  async getShared(@Param('token') token: string) {
    const data = await this.svc.getByShareToken(token);
    if (!data) return { error: 'Share link not found or disabled' };
    return data;
  }
}
