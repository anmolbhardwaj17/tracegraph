import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
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
