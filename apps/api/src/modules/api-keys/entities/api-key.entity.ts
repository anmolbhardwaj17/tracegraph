import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) keyHash: string;
  @Column() name: string;
  @Column({ default: 100 }) rateLimit: number; // requests per hour
  @CreateDateColumn() createdAt: Date;
}
