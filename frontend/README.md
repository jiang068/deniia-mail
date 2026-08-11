# 前端（Vue 3 + Vite SPA）

Deniia Mail 的前端：一个基于 Vue 3 + Vite + Vue Router 的单页应用（SPA），
包含收件箱、发件箱、撰写、邮箱管理、设置与管理员后台等页面。

> 本 README 中所有 `example.com`、`YOUR-WORKER...` 均为占位符，请替换为你自己的值。

---

## 目录结构

```
frontend/
├── index.html               SPA 入口
├── vite.config.js           Vite 配置
├── package.json
├── src/                     源码
│   ├── main.js              入口（含模块加载失败自动重刷）
│   ├── router/index.js      路由（懒加载页面）
│   ├── stores/mail.js       状态与安全渲染（DOMPurify + iframe 隔离）
│   ├── components/          通用组件
│   ├── layouts/             壳层布局（侧栏/顶栏）
│   └── views/               各页面（Home/Login/Inbox/Sent/Compose/Mailboxes/Admin...）
└── public/
    ├── config.json.example  运行时配置模板
    ├── _headers             Cloudflare Pages 缓存与安全响应头
    └── _redirects           SPA 路由回退
```

---

## 环境要求

- Node.js >= 18
- npm

```bash
npm install
```

---

## 配置运行参数

前端运行时不读取环境变量，而是读取部署后的 `/config.json`（由 `public/` 拷入 `dist/`）。

1. 复制模板生成你的配置文件：

```bash
cp public/config.json.example public/config.json
```

2. 编辑 `public/config.json`，填入两个值：

```json
{
  "baseUrl": "https://YOUR-WORKER.your-account.workers.dev",
  "defaultDomain": "example.com"
}
```

| 字段 | 含义 | 示例 |
|------|------|------|
| `baseUrl` | 后端 Worker 的地址（前端所有 API 请求都打到这） | `https://mail-backend.my-account.workers.dev` |
| `defaultDomain` | 邮箱地址所用域名（对应后端 `DOMAIN` 变量） | `example.com` |

> `config.json` 已加入 `.gitignore`，不会提交到仓库；请勿把真实域名/Worker 地址提交到公开仓库。

---

## 本地开发

```bash
npm run dev
```

默认打开 `http://localhost:5173`。本地联调时，`baseUrl` 可指向本地 `wrangler dev` 起的后端。

> 生产环境为跨域部署时，需让后端 `ALLOWED_ORIGINS` 允许本前端来源（详见 backend README）。

---

## 构建

```bash
npm run build
```

输出到 `dist/`。

> 只有 `public/` 与 `dist/` 下的文件会真正部署；`config.json` 需在构建前存在于 `public/`。

---

## 部署（Cloudflare Pages）

用 wrangler 直接上传静态目录：

```bash
npx wrangler login
npx wrangler pages deploy dist --project-name <你的 pages 项目名>
```

或关联 Git 仓库后在 Cloudflare Pages 面板配置自动构建：
- 构建命令：`npm run build`
- 输出目录：`dist`

部署成功后 Pages 会给出一个 `xxx.pages.dev` 地址，可再绑定自定义域名（推荐绑 `compose.你的域名` 或根域）。

---

## 缓存与 SPA 路由

本项目的 `public/_headers` 与 `public/_redirects` 已配置：

- **入口 HTML**（`/`、`/index.html`）：`no-cache, no-store`，确保发版后第一时间拿到最新 `index.html`。
- **静态资产**（`/assets/*`，文件名自带哈希）：`immutable, max-age=31536000`（1 年）。
- **SPA 回退**：无扩展名的路由路径（`/inbox`、`/admin` 等）回退到 `index.html`。

> 生产自定义域名若设置了额外的缓存规则（如 4 小时），请在 Cloudflare 控制台的
> **Caching → Cache Rules** 调整，使其与上述一致，否则发版后可能出现短暂加载旧资源的窗口。

前端 `main.js` 内置了模块加载失败自动重刷：当动态导入的 JS 因发版缓存错位而失败时，
会自动 `reload()` 拉取最新资源，避免白屏卡死。

---

## 相关

- 后端 API 说明与部署：见 [`../backend/README.md`](../backend/README.md)。