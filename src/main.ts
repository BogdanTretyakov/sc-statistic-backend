import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'path';
import { BufferedLogger } from './common/bufferLogger.service';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: {
      allowedHeaders: '*',
      credentials: false,
      methods: '*',
      origin: '*',
    },
  });

  // Custom logger
  app.useLogger(app.get(BufferedLogger));

  // EJS renderer
  app.setBaseViewsDir(resolve(process.cwd(), 'views'));
  app.setViewEngine('ejs');
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
