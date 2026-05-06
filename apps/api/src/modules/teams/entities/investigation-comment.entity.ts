import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('investigation_comments')
export class InvestigationComment {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column({ name: 'investigation_id', type: 'uuid' }) investigationId: string;

  @Column({ name: 'author_id', type: 'varchar', nullable: true }) authorId: string | null;
  @Column({ name: 'author_name', type: 'varchar', nullable: true }) authorName: string | null;
  @Column('text') body: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
