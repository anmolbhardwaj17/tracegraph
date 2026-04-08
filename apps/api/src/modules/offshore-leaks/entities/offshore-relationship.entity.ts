import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('offshore_relationships')
export class OffshoreRelationship {
  @PrimaryColumn() id: string;
  @Column() sourceId: string;
  @Column() targetId: string;
  @Column({ nullable: true }) relationshipType: string;
  @Column({ nullable: true }) startDate: string;
  @Column({ nullable: true }) endDate: string;
  @Column({ nullable: true }) sourceid: string;
}
