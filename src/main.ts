import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import * as fs from 'fs';
import * as path from 'path';
import { json, urlencoded } from 'express';


async function bootstrap() {
  // Load SSL certificates for HTTPS (development only)
  const isDev = process.env.NODE_ENV === 'development';
  let httpsOptions: { key: Buffer; cert: Buffer } | undefined;

  if (isDev) {
    try {
      httpsOptions = {
        key: fs.readFileSync(
          path.join(__dirname, '..', 'certificates', 'localhost-key.pem'),
        ),
        cert: fs.readFileSync(
          path.join(__dirname, '..', 'certificates', 'localhost.pem'),
        ),
      };
    } catch (error) {
      console.warn('SSL certificates not found, running without HTTPS');
    }
  }

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    ...(httpsOptions && { httpsOptions }),
  });

  // Set global prefix
  app.setGlobalPrefix('api');

  // CORS
  app.enableCors({
    // origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    origin: [
      'http://localhost:3000',
      'https://localhost:3000',
      'https://itsintrend.com',
      'https://www.itsintrend.com',
      'https://gpthumanize.pro',
      'https://www.gpthumanize.pro',
      'https://itsintrend.com',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
  });
  // Security
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Compression
  app.use(compression());

  // Cookies
  app.use(cookieParser());

  // Increase JSON payload limits for bulk saves
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger API Documentation
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('InTrend API')
      .setDescription('InTrend Agency Dashboard API')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('session_token')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  const protocol = httpsOptions ? 'https' : 'http';
  console.log(`Server running on ${protocol}://localhost:${port}`);
  console.log(`API Docs: ${protocol}://localhost:${port}/docs`);
}
bootstrap();
