import { Test, type TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('service info', () => {
    it('returns the API identity and status', () => {
      expect(appController.getServiceInfo()).toEqual({
        name: 'resume-ai',
        status: 'ok',
        version: expect.any(String) as string,
      });
    });
  });

  describe('health', () => {
    it('returns a healthy status with a timestamp', () => {
      expect(appController.getHealth()).toEqual({
        status: 'ok',
        timestamp: expect.any(String) as string,
      });
    });
  });
});
