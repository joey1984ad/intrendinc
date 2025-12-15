import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShareableLinksService } from './shareable-links.service';
import { ShareableLinksController } from './shareable-links.controller';
import { ShareableLink } from './entities/shareable-link.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ShareableLink])],
  controllers: [ShareableLinksController],
  providers: [ShareableLinksService],
  exports: [ShareableLinksService],
})
export class ShareableLinksModule {}
