import { IsString, MinLength } from 'class-validator';

export class CreateInvestigationDto {
  @IsString()
  @MinLength(1)
  query: string;
}
