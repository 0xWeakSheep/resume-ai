# resume-ai

Resume AI 的 NestJS API。使用 TypeScript 严格模式，负责后续的材料处理、AI 任务、审核与交付流程。

## 本地开发

```bash
cp .env.example .env
npm install
npm run start:dev
```

默认监听 `http://localhost:4000`：

- `GET /api/v1`：服务信息
- `GET /api/v1/health`：健康检查

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
| `WEB_ORIGIN` | `http://localhost:3000` | 允许跨域访问的 Web 地址 |

后续按照 Linear `A10-9` 继续实现数据模型、任务管线、模型调用与交付后台。
