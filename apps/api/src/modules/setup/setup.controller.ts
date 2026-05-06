import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/guards/jwt-auth.guard';

interface ConfigItem {
  key: string;
  label: string;
  configured: boolean;
  required: boolean;
  description: string;
  docsUrl?: string;
}

@ApiTags('Setup')
@Controller('setup')
export class SetupController {
  @Get('status')
  @Public()
  status() {
    const env = process.env;

    const items: ConfigItem[] = [
      {
        key: 'COMPANIES_HOUSE_API_KEY',
        label: 'Companies House API',
        configured: !!env.COMPANIES_HOUSE_API_KEY,
        required: true,
        description: 'Required for UK company investigations. Free API key.',
        docsUrl: 'https://developer.company-information.service.gov.uk/',
      },
      {
        key: 'OPENROUTER_API_KEY',
        label: 'OpenRouter (AI / Tracey)',
        configured: !!env.OPENROUTER_API_KEY,
        required: true,
        description: 'Powers Tracey AI chat and IC memo generation. Free tier available.',
        docsUrl: 'https://openrouter.ai/keys',
      },
      {
        key: 'JWT_SECRET',
        label: 'JWT Secret',
        configured: !!env.JWT_SECRET && env.JWT_SECRET !== 'tracegraph-dev-secret-change-in-production',
        required: true,
        description: 'Secret key for signing auth tokens. Set a random string in production.',
      },
      {
        key: 'RESEND_API_KEY',
        label: 'Resend (email alerts)',
        configured: !!env.RESEND_API_KEY,
        required: false,
        description: 'Optional. Sends watchlist alert emails. Free tier: 100 emails/day.',
        docsUrl: 'https://resend.com',
      },
      {
        key: 'OPENCORPORATES_API_KEY',
        label: 'OpenCorporates',
        configured: !!env.OPENCORPORATES_API_KEY,
        required: false,
        description: 'Optional. Improves non-UK company coverage (DE, FR, global).',
        docsUrl: 'https://opencorporates.com/api_accounts/new',
      },
      {
        key: 'GOOGLE_CLIENT_ID',
        label: 'Google OAuth',
        configured: !!env.GOOGLE_CLIENT_ID,
        required: false,
        description: 'Optional. Enables "Login with Google" authentication.',
      },
    ];

    const requiredMissing = items.filter((i) => i.required && !i.configured);
    const ready = requiredMissing.length === 0;

    return {
      ready,
      version: process.env.npm_package_version || '1.0.0',
      items,
      requiredMissing: requiredMissing.map((i) => i.key),
      features: {
        ukInvestigations: !!env.COMPANIES_HOUSE_API_KEY,
        aiChat: !!env.OPENROUTER_API_KEY,
        emailAlerts: !!env.RESEND_API_KEY,
        googleAuth: !!env.GOOGLE_CLIENT_ID,
        globalCompanies: !!env.OPENCORPORATES_API_KEY,
      },
    };
  }
}
