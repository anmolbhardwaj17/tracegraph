import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { InvestigationComment } from './entities/investigation-comment.entity';
import { TeamsService } from './teams.service';
import { TeamsController, SharingController } from './teams.controller';
import { Investigation } from '../investigation/entities/investigation.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Team, TeamMember, InvestigationComment, Investigation]),
    NotificationsModule,
  ],
  providers: [TeamsService],
  controllers: [TeamsController, SharingController],
  exports: [TeamsService],
})
export class TeamsModule {}
