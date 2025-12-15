import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { databaseConfig } from './database.config';
import { stripeConfig } from './stripe.config';
import { facebookConfig } from './facebook.config';
import { authConfig } from './auth.config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, stripeConfig, facebookConfig, authConfig],
      envFilePath: ['.env.local', '.env'],
    }),
  ],
})
export class ConfigModule {}
