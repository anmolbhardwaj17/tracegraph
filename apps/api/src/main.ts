import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger / OpenAPI docs at /api/docs
  const config = new DocumentBuilder()
    .setTitle('TraceGraph API')
    .setDescription('Corporate intelligence engine with 25+ data sources. Investigate companies across US, UK, India, and 20+ jurisdictions. Sanctions screening (OFAC/UK HMT/EU), PEP detection, adverse media, financial analysis, court records, and AI-powered risk narratives.')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'X-API-Key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
  if (!process.env.COMPANIES_HOUSE_API_KEY) {
    console.warn(
      '[tracegraph] COMPANIES_HOUSE_API_KEY is not set — live investigations will fail. ' +
        'Run `npm run seed:demo` to populate a demo investigation that works without a key.',
    );
  }
}
bootstrap();
