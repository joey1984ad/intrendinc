import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { StripeModule } from './stripe/stripe.module';
import { FacebookModule } from './facebook/facebook.module';
import { AiModule } from './ai/ai.module';
import { ShareableLinksModule } from './shareable-links/shareable-links.module';
import { HealthController } from './common/health.controller';
import { ProxyImageController, ProxyImageBatchController } from './common/proxy-image.controller';
import { databaseConfig } from './config/database.config';
import { stripeConfig } from './config/stripe.config';
import { facebookConfig } from './config/facebook.config';
import { authConfig } from './config/auth.config';
import { aiConfig } from './config/ai.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, stripeConfig, facebookConfig, authConfig, aiConfig],
    }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    SubscriptionsModule,
    StripeModule,
    FacebookModule,
    AiModule,
    ShareableLinksModule,
  ],
  controllers: [AppController, HealthController, ProxyImageController, ProxyImageBatchController],
  providers: [AppService],
})
export class AppModule {}

