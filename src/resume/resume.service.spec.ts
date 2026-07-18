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

const BINANCE_STYLE_RESUME = `
oftiyf
邮箱：oftiyf@gmail.com
Chainseclabs实验室 | 核心成员

项目经历
- 参与 Merkle Patricia Tree（MPT）与交易池（TxPool）设计，负责交易排序策略、节点同步流程和异常交易复现。
- 设计 Web3 安全实验室内部漏洞复现流程，沉淀 Solidity 合约审计 checklist，并协作输出复盘报告。
- 负责跨链交易加速流程优化，通过调整 Commit/Execute 流程缩短交易确认时间。
- Commit/Execute 流程缩短交易确认时间。

教育经历
某某大学 本科 计算机科学

核心能力
Solidity / Web3 / EVM / MPT / TxPool / 安全审计
`;

const BINANCE_STYLE_JD = `
岗位：Binance - Binance Accelerator Program -
1. 参与区块链基础设施、交易系统或 Web3 安全相关项目。
2. 熟悉 Blockchain、EVM、Solidity 或交易池相关机制。
3. 能够进行研究分析、问题复盘和跨团队协作。
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
    expect(result.rewrite.sourceFacts.length).toBeGreaterThan(0);
    expect(
      result.rewrite.rewrittenExperienceBullets.some(
        (suggestion) => suggestion.sourceFactIds.length > 0,
      ),
    ).toBe(true);
    expect(result.rewrite.rewrittenExperienceBullets[0]).toMatchObject({
      riskLevel: expect.stringMatching(/low|medium|high/) as string,
      riskReasons: expect.any(Array) as string[],
      acceptedByDefault: expect.any(Boolean) as boolean,
    });
    expect(
      result.rewrite.rewrittenExperienceBullets.every(
        (suggestion) =>
          suggestion.riskLevel !== 'high' || !suggestion.acceptedByDefault,
      ),
    ).toBe(true);
    expect(result.rewrite.finalResumeMarkdown).toContain('张三');
    expect(result.rewrite.finalResumeMarkdown).toContain(
      '某某大学 本科 信息管理',
    );
    expect(result.rewrite.finalResumeMarkdown).not.toContain('## 资料概览');
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

  it('recommends role directions from resume without requiring a JD', async () => {
    const result = await service.recommendRoles({
      resume: { text: SAMPLE_RESUME },
    });

    expect(result.factBase.totalFacts).toBeGreaterThan(8);
    expect(result.recommendations.length).toBeGreaterThan(0);
    const firstRecommendation = result.recommendations[0];
    expect(firstRecommendation).toBeDefined();
    expect(firstRecommendation?.roleTitle).toBe('AI 产品经理');
    expect(firstRecommendation?.roleDescription.length).toBeGreaterThan(0);
    expect(firstRecommendation?.relevanceScore).toBeGreaterThan(0);
    expect(firstRecommendation?.matchedKeywords).toEqual(
      expect.arrayContaining(['AI', '需求分析']),
    );
    expect(firstRecommendation?.matchedFacts.length).toBeGreaterThan(0);
    expect(firstRecommendation?.gaps.length).toBeGreaterThan(0);
    expect(firstRecommendation?.reason).toContain('可追溯事实');
    expect(result.summary.total).toBe(result.recommendations.length);
  });

  it('recommends Web3 directions for blockchain security resumes', async () => {
    const result = await service.recommendRoles({
      resume: { text: BINANCE_STYLE_RESUME },
    });
    const titles = result.recommendations.map((item) => item.roleTitle);

    expect(titles).toEqual(
      expect.arrayContaining(['Web3 安全研究员', '区块链基础设施工程师']),
    );
    const web3Security = result.recommendations.find(
      (item) => item.roleTitle === 'Web3 安全研究员',
    );
    expect(web3Security?.matchedKeywords).toEqual(
      expect.arrayContaining(['Web3', 'Solidity']),
    );
    expect(web3Security?.matchedFacts.length).toBeGreaterThan(0);
  });

  it('uses uploaded resume file before resume text when both exist', async () => {
    const fileResume = `
李四
数据产品经理

项目经历
- 负责数据分析平台需求设计，推动 SQL 指标看板上线，支持业务团队复盘增长实验。

教育经历
某某大学 本科 统计学

核心能力
数据分析 / SQL / 增长实验 / 产品设计
`;
    const result = await service.extractFacts({
      resume: {
        text: SAMPLE_RESUME,
        file: {
          name: 'resume.txt',
          mimeType: 'text/plain',
          dataBase64: Buffer.from(fileResume, 'utf8').toString('base64'),
        },
      },
    });

    expect(result.parsedResume.sourceType).toBe('text');
    expect(result.parsedResume.rawText).toContain('李四');
    expect(result.parsedResume.rawText).not.toContain('张三');
  });

  it('keeps the complete original resume structure in the editable final resume', async () => {
    const result = await service.customize({
      resume: { text: BINANCE_STYLE_RESUME },
      jobDescription: BINANCE_STYLE_JD,
    });
    const finalMarkdown = result.rewrite.finalResumeMarkdown;
    const rewrittenText = result.rewrite.rewrittenExperienceBullets
      .map((suggestion) => `${suggestion.before}\n${suggestion.after}`)
      .join('\n');

    expect(result.parsedJobDescription.roleTitle).toBe(
      'Binance - Binance Accelerator Program',
    );
    expect(result.parsedResume.extracted.experienceBullets).toEqual(
      expect.arrayContaining([
        expect.stringContaining('MPT'),
        expect.stringContaining('Solidity'),
      ]),
    );
    expect(finalMarkdown).toContain('oftiyf');
    expect(finalMarkdown).toContain('邮箱：oftiyf@gmail.com');
    expect(finalMarkdown).toContain('Chainseclabs实验室 | 核心成员');
    expect(finalMarkdown).toContain('某某大学 本科 计算机科学');
    expect(finalMarkdown).toContain(
      'Solidity / Web3 / EVM / MPT / TxPool / 安全审计',
    );
    expect(finalMarkdown).toContain('MPT');
    expect(finalMarkdown).toContain('TxPool');
    expect(finalMarkdown).not.toContain('定制简历草稿');
    expect(finalMarkdown).not.toContain('## 资料概览');
    expect(finalMarkdown).not.toContain('生成边界');
    expect(finalMarkdown).not.toContain('## 人工审核提示');
    expect(finalMarkdown.match(/Commit\/Execute/g)).toHaveLength(1);
    result.rewrite.rewrittenExperienceBullets
      .filter(
        (suggestion) =>
          suggestion.acceptedByDefault && suggestion.riskLevel === 'low',
      )
      .forEach((suggestion) => {
        expect(finalMarkdown).toContain(suggestion.after);
      });
    expect(rewrittenText).not.toContain('邮箱');
    expect(rewrittenText).not.toContain('Chainseclabs实验室 | 核心成员');
    expect(result.rewrite.skillsToEmphasize).not.toContain('AI');
  });

  it('filters job-page navigation, privacy and benefits noise before mapping', async () => {
    const result = await service.standardizeJobs({
      jobDescriptions: [
        `
Binance Careers
Sign in
岗位：Blockchain Security Engineer
Responsibilities
- Build and maintain blockchain security analysis tooling.
Qualifications
- Must have Solidity and EVM experience.
Benefits
- Competitive salary and health insurance.
Privacy Policy
All rights reserved.
`,
      ],
    });
    const job = result.jobs[0];
    const requirementText = job?.requirements
      .map((requirement) => requirement.text)
      .join('\n');

    expect(job?.requirements).toHaveLength(2);
    expect(requirementText).toContain('blockchain security analysis tooling');
    expect(requirementText).toContain('Solidity and EVM experience');
    expect(requirementText).not.toMatch(
      /Sign in|Competitive salary|Privacy Policy|All rights reserved/i,
    );
  });

  it('does not treat a single generic AI keyword as partial evidence', async () => {
    const result = await service.customize({
      resume: {
        text: `
王五
项目经历
- 参与 AI 内容工具需求讨论，整理用户反馈并协作完成版本验收。
核心能力
AI
`,
      },
      jobDescription: `
岗位：业务策略经理
1. 具备 AI 相关经验和能力。
`,
    });
    const mapping = result.analysis.requirementMappings[0];

    expect(mapping).toMatchObject({
      status: 'missing',
      matchedKeywords: [],
      evidence: [],
    });
  });

  it('keeps a quantified skill requirement partial when years are unproven', async () => {
    const result = await service.customize({
      resume: { text: BINANCE_STYLE_RESUME },
      jobDescription: `
岗位：智能合约安全工程师
1. 具备 3 年以上 Solidity 智能合约审计经验。
`,
    });

    expect(result.analysis.requirementMappings[0]).toMatchObject({
      status: 'partial',
      matchedKeywords: expect.arrayContaining(['Solidity']) as string[],
    });
  });

  it('does not promote unlimited, optional or preferred conditions to hard requirements', async () => {
    const result = await service.standardizeJobs({
      jobDescriptions: [
        `
岗位：Web3 研究员
1. 学历不限，经验不限，可远程办公。
2. 掌握 ERC-721 属于加分项，可选。
3. 必须掌握 Solidity 与 EVM。
`,
      ],
    });
    const hardRequirements = result.jobs[0]?.hardRequirements ?? [];

    expect(hardRequirements.length).toBeGreaterThan(0);
    expect(
      hardRequirements.every((item) => !/不限|加分|可选/.test(item.text)),
    ).toBe(true);
    expect(hardRequirements.some((item) => /Solidity/.test(item.text))).toBe(
      true,
    );
  });

  it('rejects model-injected skills and unsupported amplified claims', async () => {
    const previousApiKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  rewrittenExperienceBullets: [
                    {
                      sourceFactId: 'EXPERIENCE-1',
                      after:
                        '精通 ERC-721 与 ERC-20，具备大规模主网套利实战经验。',
                      reason: '增强岗位匹配度',
                    },
                  ],
                  skillsToEmphasize: ['ERC-721', 'ERC-20', 'Solidity'],
                }),
              },
            },
          ],
        }),
    } as Response);

    try {
      const result = await service.customize({
        resume: { text: BINANCE_STYLE_RESUME },
        jobDescription: BINANCE_STYLE_JD,
      });
      const output = [
        result.rewrite.finalResumeMarkdown,
        ...result.rewrite.rewrittenExperienceBullets.map(
          (suggestion) => suggestion.after,
        ),
        ...result.rewrite.skillsToEmphasize,
      ].join('\n');

      expect(output).not.toContain('ERC-721');
      expect(output).not.toContain('ERC-20');
      expect(output).not.toContain('主网套利');
      expect(result.rewrite.skillsToEmphasize).toContain('Solidity');
    } finally {
      fetchSpy.mockRestore();
      if (previousApiKey === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = previousApiKey;
      }
    }
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

  it('deduplicates similar JDs and ranks matches against resume facts', async () => {
    const result = await service.standardizeJobs({
      resume: { text: SAMPLE_RESUME },
      jobDescriptions: [
        SAMPLE_JD,
        `
岗位：AI 产品经理
1. 负责 AI 应用产品的需求分析和产品设计。
2. 熟悉 RAG 和数据分析，能够推动跨团队落地。
`,
        `
岗位：增长产品经理
1. 负责 B端 SaaS 增长实验和数据分析。
2. 熟悉 SQL 和 A/B测试，能够推动跨团队项目。
`,
        `
岗位：云原生平台工程师
1. 硕士及以上学历，5 年以上 Kubernetes 和 AWS 生产部署经验。
2. 必须熟悉 Go、Kubernetes、AWS。
`,
      ],
    });
    const duplicate = result.jobs.find((job) => job.status === 'duplicate');
    const blocked = result.jobs.find(
      (job) => job.roleTitle === '云原生平台工程师',
    );
    const readyJobs = result.jobs.filter((job) => job.status === 'ready');

    expect(result.summary).toMatchObject({
      total: 4,
      ready: 3,
      duplicate: 1,
      ranked: 3,
      blocked: 1,
    });
    expect(result.jobs[0]).toMatchObject({
      roleTitle: 'AI 产品经理',
      priorityRank: 1,
      filterStatus: 'pass',
    });
    expect(result.jobs[0].match?.score).toBeGreaterThan(60);
    expect(duplicate?.duplicateOf).toBe('JOB-1');
    expect(blocked).toMatchObject({
      filterStatus: 'blocked',
      match: {
        blockedByHardRequirements: true,
      },
    });
    expect(readyJobs.map((job) => job.priorityRank)).toEqual([1, 2, 3]);
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
