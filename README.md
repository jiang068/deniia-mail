# Mail（化名，原 Deniia Mail）

Serverless 网页邮箱系统，基于 Cloudflare Workers + D1 + Email Routing + Resend。

本仓库分为两个独立项目，可分别部署：

```
mail/
├── backend/          Cloudflare Worker 后端（API、收件、发件、管理后台数据）
│   ├── README.md     后端部署教程、API 文档
│   ├── worker.js     后端源码
│   ├── schema.sql    D1 建表脚本
│   └── wrangler.toml.example  配置模板（复制为 wrangler.toml 填写）
│
├── frontend/         前端（Vue 3 + Vite + Vue Router SPA）
│   ├── README.md     前端部署教程
│   ├── public/config.json.example  运行时配置模板（复制为 config.json 填写）
│   └── src/          源代码（收件箱、发件箱、撰写、管理后台等页面）
│
└── README.md         本文件
```

> **隐私说明**：本示例中的域名、Worker 地址、数据库 ID 均为占位符（如 `example.com`）。
> 部署时请按各子目录 README 的指引，替换为你自己的域名与账号信息。

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Cloudflare Workers（JavaScript） |
| 数据库 | Cloudflare D1（SQLite） |
| 收件 | Cloudflare Email Routing |
| 发件 | Resend REST API |
| 邮件解析 | postal-mime |
| 前端 | Vue 3 + Vite + Vue Router |

## 部署概览

1. **后端**：见 [`backend/README.md`](backend/README.md)
   - 配置 `wrangler.toml`（`example.com` → 你的域名、D1 数据库 ID）
   - 在 Cloudflare Secret 中配置 `BOOTSTRAP_TOKEN`（首次初始化）、`RESEND_API_KEY`（发件）和可选的 `RESEND_WEBHOOK_SECRET`（投递状态回调）
   - Cloudflare Email Routing 收件 → Worker
   - 新数据库使用完整的 `schema.sql` 初始化；已有生产数据库不要重复初始化

2. **前端**：见 [`frontend/README.md`](frontend/README.md)
   - `npm install` → `npm run build`
   - 把 `dist/` 部署到 Cloudflare Pages
   - 配置 `config.json`（后端 Worker 地址 + 邮箱域名）

两个项目相互独立，后端提供 API，前端消费 API，可在同一域名下或跨域部署。

详见各子目录的 README。
