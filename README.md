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
- `POST /api/v1/resume/roles/recommend`：不提供 JD 时，基于简历事实库推荐岗位方向、相关性、依据和缺口
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

| 名称                | 默认值                     | 说明                                                                             |
| ------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| `PORT`              | `4000`                     | API 监听端口                                                                     |
| `HOST`              | `127.0.0.1`                | API 监听地址；通过反向代理部署时保持本机绑定                                     |
| `WEB_ORIGIN`        | `http://localhost:3000`    | 允许跨域访问的 Web 地址，多个地址用逗号分隔                                      |
| `WEB_ORIGIN_REGEX`  | 空                         | 允许跨域访问的 Web 地址正则，多个正则用逗号分隔；用于 Vercel preview/branch 域名 |
| `DEEPSEEK_API_KEY`  | 空                         | DeepSeek API key，只在部署环境配置，不提交到仓库                                 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API 基础地址                                                            |
| `DEEPSEEK_MODEL`    | `deepseek-chat`            | 默认使用的 DeepSeek 模型                                                         |

## 当前 MVP 能力

- 文件优先：同时传入文件和文本时，优先解析上传文件。
- 事实约束：生成内容只引用简历事实库和用户补充信息，不直接写入无法证明的能力。
- 完整最终稿：`finalResumeMarkdown` 保留原简历中的姓名、联系方式、组织/角色、教育、技能和经历正文，只原位替换通过事实校验的经历条目；分析、风险和审核提示保留在独立响应字段中。
- 模型防注入：DeepSeek 改写按职业事实 ID 绑定，新增数字、无证据技能和放大性表述会被拒绝并回退到原始事实。
- 反向匹配：没有 JD 时，可先基于简历推荐岗位方向，不输出具体公司、真实 JD 链接或投递入口。
- JD 批处理：支持多个 JD 文本或链接输入，过滤招聘页导航、隐私、福利等噪声；失败项不阻塞其他可用岗位。
- 证据映射：岗位要求只使用可回溯的经历、技能或教育事实判定匹配；单个 `AI`/`API` 等泛关键词不会单独形成匹配证据。
- 硬门槛识别：明确排除“不限”“可选”“优先”“加分”等软性条件，避免误判为阻断门槛。
- 质量检查：返回关键词覆盖、事实一致性、可读性、格式检查和人工审核清单。
