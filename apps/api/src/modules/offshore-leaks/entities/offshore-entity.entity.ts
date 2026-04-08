import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('offshore_entities')
export class OffshoreEntity {
  @PrimaryColumn() id: string;
  @Column() name: string;
  @Column({ nullable: true }) jurisdiction: string;
  @Column({ nullable: true }) country: string;
  @Column({ nullable: true }) incorporationDate: string;
  @Column({ nullable: true }) inactivationDate: string;
  @Column({ nullable: true }) status: string;
  @Column({ nullable: true }) sourceid: string;
  @Column({ nullable: true }) searchText: string;
}
