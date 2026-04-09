import { IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class CreateInvestigationDto {
  @IsString()
  @MinLength(1)
  query: string;

  @IsOptional()
  @IsIn(['QUICK', 'STANDARD', 'DEEP'])
  tier?: 'QUICK' | 'STANDARD' | 'DEEP';
}
