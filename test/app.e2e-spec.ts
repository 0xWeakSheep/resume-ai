import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('AppController (e2e)', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  it('/api/v1 (GET)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ name: 'resume-ai', status: 'ok' });
      });
  });

  it('/api/v1/health (GET)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ status: 'ok' });
        expect(body.timestamp).toEqual(expect.any(String));
      });
  });

  it('/api/v1/resume/customize (POST)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/resume/customize')
      .send({
        resume: {
          text: `
项目经历
- 负责 AI 客服工作台需求分析，推动 RAG 知识库检索上线。
- 协作算法和研发团队优化推荐流程，试点效率提升 20%。
核心能力
AI 产品设计 / 需求分析 / 数据分析 / 跨团队协作
`,
        },
        jobDescription: `
岗位：AI 产品经理
1. 负责 AI 应用产品需求分析和产品设计。
2. 熟悉 RAG 和 LLM，能推动跨团队落地。
3. 具备数据分析能力。
`,
      })
      .expect(201)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toHaveProperty('parsedResume');
        expect(body).toHaveProperty('analysis');
        expect(body).toHaveProperty('rewrite');
        expect(body).toHaveProperty('quality');
        expect(body.rewrite).toMatchObject({
          sourceFacts: expect.any(Array) as unknown[],
        });
      });
  });

  it('/api/v1/resume/facts (POST)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/resume/facts')
      .send({
        resume: {
          text: `
项目经历
- 负责 AI 客服工作台需求分析，推动 RAG 知识库检索上线。
- 协作算法和研发团队优化推荐流程，试点效率提升 20%。
教育经历
某某大学 本科 信息管理
核心能力
AI 产品设计 / 需求分析 / 数据分析 / 跨团队协作
`,
        },
      })
      .expect(201)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toHaveProperty('parsedResume');
        expect(body).toHaveProperty('factBase');
        expect(body.factBase).toMatchObject({
          sourceType: 'plain-text',
          totalFacts: expect.any(Number) as number,
        });
      });
  });

  it('/api/v1/resume/jobs/standardize (POST)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/resume/jobs/standardize')
      .send({
        jobDescriptions: [
          `
公司：某 AI SaaS 公司
岗位：AI 产品经理
1. 本科及以上学历，3 年以上 AI 产品经验。
2. 熟悉 RAG、LLM 和数据分析，能推动跨团队落地。
`,
        ],
        jobUrls: ['http://localhost:4000/private-job'],
      })
      .expect(201)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toHaveProperty('jobs');
        expect(body).toHaveProperty('summary');
        expect(body.summary).toMatchObject({
          total: 2,
          ready: 1,
          failed: 1,
        });
      });
  });

  it('/api/v1/resume/jobs/standardize ranks against resume (POST)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/resume/jobs/standardize')
      .send({
        resume: {
          text: `
项目经历
- 负责 AI 客服工作台需求分析，推动 RAG 知识库检索上线。
- 协作算法和研发团队优化推荐流程，试点效率提升 20%。
教育经历
某某大学 本科 信息管理
核心能力
AI 产品设计 / 需求分析 / 数据分析 / 跨团队协作 / A/B测试
`,
        },
        jobDescriptions: [
          `
岗位：AI 产品经理
1. 负责 AI 应用产品需求分析和产品设计。
2. 熟悉 RAG 和 LLM，能推动跨团队落地。
3. 具备数据分析能力。
`,
          `
岗位：云原生平台工程师
1. 硕士及以上学历，5 年以上 Kubernetes 和 AWS 生产部署经验。
2. 必须熟悉 Go、Kubernetes、AWS。
`,
        ],
      })
      .expect(201)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        const jobs = body.jobs as Array<Record<string, unknown>>;

        expect(body.summary).toMatchObject({
          total: 2,
          ready: 2,
          ranked: 2,
          blocked: 1,
        });
        expect(jobs[0]).toMatchObject({
          roleTitle: 'AI 产品经理',
          priorityRank: 1,
          filterStatus: 'pass',
        });
        expect(jobs[0].match).toMatchObject({
          score: expect.any(Number) as number,
          blockedByHardRequirements: false,
        });
        expect(jobs[1]).toMatchObject({
          roleTitle: '云原生平台工程师',
          filterStatus: 'blocked',
        });
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
