import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('investigation_notes')
export class InvestigationNote {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column({ name: 'investigation_id', type: 'uuid' }) investigationId: string;

  @Column({ name: 'author_name', type: 'varchar', nullable: true }) authorName: string | null;
  @Column('text') body: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
