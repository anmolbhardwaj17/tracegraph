import { Controller, Get } from '@nestjs/common';
import { getAllJurisdictions, getJurisdictionChoices } from './jurisdiction.registry';

@Controller('api/jurisdictions')
export class JurisdictionsController {
  @Get()
  list() {
    return getAllJurisdictions();
  }

  @Get('choices')
  choices() {
    return getJurisdictionChoices();
  }
}
