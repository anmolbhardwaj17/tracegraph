import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('geocode_cache')
export class GeocodeCache {
  @PrimaryColumn() addressKey: string;

  @Column({ type: 'double precision', nullable: true }) lat: number;
  @Column({ type: 'double precision', nullable: true }) lng: number;
  @Column({ type: 'varchar', nullable: true }) displayName: string;

  @Column({ default: false }) notFound: boolean;

  @CreateDateColumn() createdAt: Date;
}
