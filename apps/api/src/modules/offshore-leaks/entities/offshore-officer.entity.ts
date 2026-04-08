import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('offshore_officers')
export class OffshoreOfficer {
  @PrimaryColumn() id: string;
  @Column() name: string;
  @Column({ nullable: true }) country: string;
  @Column({ nullable: true }) sourceid: string;
  @Column({ nullable: true }) searchText: string;
}
