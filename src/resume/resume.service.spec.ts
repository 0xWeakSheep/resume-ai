import { BadRequestException } from '@nestjs/common';
import { ResumeService } from './resume.service';

const SAMPLE_RESUME = `
张三
产品经理

项目经历
- 负责 AI 客服工作台的需求分析和产品设计，协作算法与研发团队上线 RAG 知识库检索能力。
- 推动客服后台从人工检索升级为自动化推荐，试点团队处理效率提升 20%。

教育经历
某某大学 本科 信息管理

核心能力
AI 产品设计 / 需求分析 / 数据分析 / 跨团队协作 / A/B测试
`;

const SAMPLE_JD = `
岗位：AI 产品经理
1. 负责 AI 应用产品的需求分析、产品设计和跨团队协作。
2. 熟悉 RAG、LLM、Prompt 等 AI 应用能力，能和算法团队共同推进方案落地。
3. 具备数据分析能力，能够设计 A/B测试 并评估业务效果。
4. 有 SaaS 商业化经验优先。
`;

describe('ResumeService', () => {
  let service: ResumeService;

  beforeEach(() => {
    service = new ResumeService();
  });

  it('generates a complete customization report from fixed samples', async () => {
    const result = await service.customize({
      resume: { text: SAMPLE_RESUME },
      jobDescription: SAMPLE_JD,
    });

    expect(
      result.parsedResume.extracted.experienceBullets.length,
    ).toBeGreaterThan(0);
    expect(
      result.parsedJobDescription.requirements.length,
    ).toBeGreaterThanOrEqual(4);
    expect(result.analysis.requirementMappings.length).toBeGreaterThanOrEqual(
      4,
    );
    expect(result.analysis.matchedKeywords).toEqual(
      expect.arrayContaining(['AI', 'RAG', '需求分析', '数据分析']),
    );
    expect(result.rewrite.rewrittenExperienceBullets.length).toBeGreaterThan(0);
    expect(result.rewrite.finalResumeMarkdown).toContain('AI 产品经理');
    expect(result.quality.keywordCoverage.ratio).toBeGreaterThan(0.4);
    expect(result.quality.factConsistency.riskLevel).toBe('low');
    expect(result.quality.manualReviewChecklist.length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('keeps unsupported keywords as follow-up questions instead of inventing facts', async () => {
    const result = await service.customize({
      resume: { text: SAMPLE_RESUME },
      jobDescription: `${SAMPLE_JD}\n5. 必须有 Kubernetes 和 AWS 生产部署经验。`,
    });

    expect(result.analysis.missingKeywords).toEqual(
      expect.arrayContaining(['Kubernetes', 'AWS']),
    );
    expect(result.analysis.followUpQuestions.join('\n')).toContain(
      'Kubernetes',
    );
  });

  it('extracts a structured career fact base with evidence', async () => {
    const result = await service.extractFacts({
      resume: { text: SAMPLE_RESUME },
    });

    expect(result.factBase.totalFacts).toBeGreaterThan(8);
    expect(result.factBase.grouped.experience.length).toBeGreaterThan(0);
    expect(
      result.factBase.grouped.skill.some(
        (fact) => fact.detail === 'AI' && fact.evidence.includes('AI'),
      ),
    ).toBe(true);
    expect(
      result.factBase.grouped.metric.some(
        (fact) => fact.detail === '20%' && fact.confidence === 'high',
      ),
    ).toBe(true);
    expect(result.factBase.facts[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String) as string,
        evidence: expect.any(String) as string,
      }),
    );
  });

  it('standardizes multiple JD sources and isolates failures', async () => {
    const result = await service.standardizeJobs({
      jobDescriptions: [
        SAMPLE_JD,
        `
公司：某 AI SaaS 公司
岗位：增长产品经理
1. 本科及以上学历，3 年以上 B端 SaaS 增长经验。
2. 熟悉 SQL 和数据分析，必须能推动 A/B测试。
`,
        SAMPLE_JD,
      ],
      jobUrls: ['http://localhost:4000/private-job'],
    });

    expect(result.summary).toMatchObject({
      total: 4,
      ready: 2,
      failed: 1,
      duplicate: 1,
    });
    expect(result.jobs[0]).toMatchObject({
      status: 'ready',
      roleTitle: 'AI 产品经理',
    });
    expect(result.jobs[1].company).toBe('某 AI SaaS 公司');
    expect(result.jobs[1].roleTitle).toBe('增长产品经理');
    expect(result.jobs[1].hardRequirements.length).toBeGreaterThan(0);
    expect(result.jobs[2].status).toBe('duplicate');
    expect(result.jobs[3].warnings.join('\n')).toContain('内网或本机地址');
  });

  it('rejects empty resume input', async () => {
    await expect(
      service.customize({
        resume: { text: '太短' },
        jobDescription: SAMPLE_JD,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
