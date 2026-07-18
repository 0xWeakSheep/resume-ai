# resume-ai

Resume AI 的 NestJS API。使用 TypeScript 严格模式，负责简历材料解析、JD 标准化、匹配分析、定制改写、质量检查与导出前审核数据。

## 本地开发

```bash
cp .env.example .env
npm install
npm run start:dev
```

默认监听 `http://localhost:4000`：

- `GET /api/v1`：服务信息
- `GET /api/v1/health`：健康检查
- `POST /api/v1/resume/facts`：从简历文本或上传文件中抽取结构化职业事实库
- `POST /api/v1/resume/jobs/standardize`：标准化 JD 文本/链接，完成去重、硬门槛过滤和匹配排序
- `POST /api/v1/resume/customize`：基于职业事实和目标 JD 生成定制简历、改写理由和质量检查

## 可用命令

```bash
npm run lint
npm test
npm run test:e2e
npm run build
npm run start:prod
```

## 环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4000` | API 监听端口 |
| `HOST` | `127.0.0.1` | API 监听地址；通过反向代理部署时保持本机绑定 |
| `WEB_ORIGIN` | `http://localhost:3000` | 允许跨域访问的 Web 地址，多个地址用逗号分隔 |
| `WEB_ORIGIN_REGEX` | 空 | 允许跨域访问的 Web 地址正则，多个正则用逗号分隔；用于 Vercel preview/branch 域名 |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek API key，只在部署环境配置，不提交到仓库 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API 基础地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 默认使用的 DeepSeek 模型 |

## 当前 MVP 能力

- 文件优先：同时传入文件和文本时，优先解析上传文件。
- 事实约束：生成内容只引用简历事实库和用户补充信息，不直接写入无法证明的能力。
- JD 批处理：支持多个 JD 文本或链接输入，失败项不阻塞其他可用岗位。
- 质量检查：返回关键词覆盖、事实一致性、可读性、格式检查和人工审核清单。
