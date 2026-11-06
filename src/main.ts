import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';
import { seedEstados } from './database/seeds/estado.seed';

const ORIGENES_POR_DEFECTO = ['http://localhost:4200'];

function origenesPermitidos(): string[] {
  const origenes = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);
  return origenes.length > 0 ? origenes : ORIGENES_POR_DEFECTO;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Número de proxies delante de la API. Sin esto, detrás de un proxy todos los
  // clientes comparten IP y el rate limiting los trataría como uno solo.
  const proxies = Number(process.env.TRUST_PROXY ?? 0);
  if (proxies > 0) {
    app.set('trust proxy', proxies);
  }

  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({ origin: origenesPermitidos() });

  const dataSource = app.get(DataSource);
  await seedEstados(dataSource);

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((err) => {
  console.error('Application failed to start', err);
  process.exit(1);
});
