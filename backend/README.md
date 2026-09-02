# 后端（Cloudflare Worker）

邮件系统的后端：一个 Cloudflare Worker，提供全部 API（收件、发件、用户、邮箱、管理后台），
数据存于 D1，收件走 Email Routing，发件走 Resend。

> 本 README 中 `example.com`、`<your-database-id>` 等均为占位符，请替换为你自己的值。

---

## 功能

- **邮件接收**：通过 Cloudflare Email Routing 收到邮件，自动解析并写入 D1
- **邮件发送**：集成 Resend，支持纯文本 / HTML，记录发件日志与投递状态
- **多邮箱**：每用户可拥有多个邮箱，收/发分离，可申请与删除
- **Catch-all / 发件白名单**：防止陌生发件方刷量爆存储——
  分「关闭 / 白名单 / 全放开」三档模式 + 可按发件方域名后缀白名单收信
- **邮件管理**：查看、删除单封邮件，清空邮箱，转发 / 收藏
- **发件记录**：查询历史、查看详情、删除，实时投递状态（webhook 回调）
- **全站发件限额**：按日统计全站发件量，对照 Resend 每日配额自动拦截
- **用户系统**：注册 / 登录（Bearer Token）、角色（user / admin）、邀请码
- **管理员后台**：系统设置、用户管理、邮箱 / 邮件查看、邀请码、发件统计、发件白名单

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers |
| 数据库 | Cloudflare D1（SQLite） |
| 收件 | Cloudflare Email Routing |
| 发件 | Resend REST API |
| 投递状态 | Resend Webhook + Svix 签名校验 |
| 邮件解析 | postal-mime |

---

## 前置条件

- Node.js >= 18
- [Cloudflare 账号](https://dash.cloudflare.com/)
- [Resend 账号](https://resend.com)

```bash
npm install
```

---

## 部署教程

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

### 2. 创建 D1 数据库

```bash
npx wrangler d1 create mail-db
```

输出示例：

```
✅ Created D1 database: mail-db
database_id = "<your-database-id>"
```

### 3. 配置 wrangler.toml

```bash
cp wrangler.toml.example wrangler.toml
```

编辑 `wrangler.toml`，填入：

```toml
[[d1_databases]]
binding = "DB"
database_name = "mail-db"
database_id = "<your-database-id>"   # 第 2 步得到的 ID

[vars]
DOMAIN = "example.com"               # 你的邮箱域名
ALLOWED_ORIGINS = "https://compose.example.com"  # 允许调用 API 的前端来源
```

> `wrangler.toml` 已加入 `.gitignore`，不会被提交，公开仓库只提交 `wrangler.toml.example`。

### 4. 初始化数据库

```bash
# 建表
npx wrangler d1 execute mail-db --file=schema.sql --remote

# 若有增量迁移也要执行（按编号）
npx wrangler d1 execute mail-db --file=migrations/001_add_delivery_status.sql --remote
npx wrangler d1 execute mail-db --file=migrations/002_invite_codes.sql --remote
npx wrangler d1 execute mail-db --file=migrations/003_catchall_whitelist.sql --remote
npx wrangler d1 execute mail-db --file=migrations/004_performance.sql --remote
```

### 5. 配置初始化密钥

部署完成后，在 Cloudflare Dashboard → **Workers & Pages** → 你的 Worker →
**Settings → Variables and Secrets** 中添加 `BOOTSTRAP_TOKEN`。
它用于首次在网页初始化管理员，且不会写入前端或 D1。

也可以使用 Wrangler 设置：

```bash
npx wrangler secret put BOOTSTRAP_TOKEN
```

### 6. 配置 Resend（发件必需）

```bash
npx wrangler secret put RESEND_API_KEY
```

也可以在 Cloudflare Dashboard 的同一处添加 `RESEND_API_KEY`。

> **获取 Key：**
> 1. 登录 [Resend](https://resend.com)
> 2. Domains → Add Domain → 验证你的发件域名
> 3. API Keys → Create API Key → 权限勾选 `Email: send` / `Inbound: read`
> 4. 复制生成的 `re_...` Key

### 7. 配置投递状态 Webhook（推荐）

在 Resend → Webhooks 新建，事件选 `email.sent` / `email.delivered` / `email.bounced` / `email.complained` / `email.opened` / `email.clicked`，
URL 填 Worker 的 custom domain + `/api/webhooks/resend`（如 `https://mail-backend.example.com/api/webhooks/resend`），
并复制 Signing Secret，然后：

```bash
npx wrangler secret put RESEND_WEBHOOK_SECRET
```

> 这样发件状态的「发送中 / 已送达 / 已退回」会实时更新。

### 8. 配置 Email Routing 收件

1. Cloudflare Dashboard → **Email → Email Routing**
2. 添加域名并按提示配置 DNS（MX 等）
3. 创建路由规则：`*@example.com` → **Workers** → `webmail-backend`

> 确保 `wrangler.toml` 的 `DOMAIN` 与 Email Routing 域名一致。
> **收件是免费且不限量的**，与 Resend 的发件配额（免费档约 100 封/天、3000 封/月）相互独立。

### 9. 部署

```bash
npx wrangler deploy
```

部署成功后输出 Worker URL，形如 `https://webmail-backend.xxx.workers.dev`，前端用它作 `baseUrl`。

### 10. 首次初始化管理员

打开前端的注册页面，输入 `BOOTSTRAP_TOKEN` 和管理员账号密码，即可创建第一个管理员账号。
也可以调用 `POST /api/admin/setup`，提交 `setup_token`、`username`、`password` 完成初始化。
首次初始化只在 `users` 表完全为空时有效；一旦出现过用户，即使管理员后来被删除或降权，也不会再次开放免邀请码的管理员注册。
初始化完成后即可在管理后台配置邀请码、白名单、限额等。

---

## 配置汇总

| 配置项 | 方式 | 说明 |
|--------|------|------|
| `DOMAIN` | `wrangler.toml` `[vars]` | 邮箱域名，如 `example.com` |
| `ALLOWED_ORIGINS` | `wrangler.toml` `[vars]` | 允许跨域调用 API 的前端来源，逗号分隔 |
| `database_id` | `wrangler.toml` `[[d1_databases]]` | D1 数据库 ID |
| `BOOTSTRAP_TOKEN` | Cloudflare Secret | 首次网页初始化管理员的密钥（必需） |
| `RESEND_API_KEY` | Cloudflare Secret | Resend API Key（发件必需） |
| `RESEND_WEBHOOK_SECRET` | Cloudflare Secret | Resend Webhook 签名密钥（启用 Webhook 时必需） |

`wrangler.toml` 已配置 `*/5 * * * *` Cron Trigger，作为 Webhook 之外的投递状态兜底轮询。

---

## API 一览

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/check` | 检查是否存在管理员及是否已初始化 |
| POST | `/api/admin/setup` | 使用初始化密钥创建第一个管理员（JSON：`setup_token`、`username`、`password`） |
| POST | `/api/register` | 注册普通用户（受开关/邀请码控制） |
| POST | `/api/login` | 登录，返回 Bearer token |
| GET | `/api/domains` | 可用域名列表 |
| POST | `/api/webhooks/resend` | Resend 投递状态 Webhook |

### 认证接口（`Authorization: Bearer <token>`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mailboxes` | 当前用户的邮箱列表 |
| GET | `/api/me` | 一次返回当前用户、邮箱列表和配额（前端首屏使用） |
| GET | `/api/mailbox/info?address=` | 邮箱详情（转发/收藏） |
| POST | `/api/mailbox/forward` | 设置转发目标 |
| POST | `/api/mailbox/favorite` | 切换收藏 |
| GET | `/api/generate` | 随机生成邮箱 |
| POST | `/api/create` | 自定义创建邮箱 |
| DELETE | `/api/mailbox/:id` | 删除邮箱（及其邮件） |
| GET | `/api/emails?mailbox=` | 邮件列表 |
| GET | `/api/email/:id` | 邮件详情 |
| DELETE | `/api/email/:id` | 删除邮件 |
| DELETE | `/api/emails?mailbox=` | 清空邮箱 |
| GET | `/api/user/quota` | 邮箱配额 |
| POST | `/api/send` | 发送邮件（Resend）
| GET | `/api/sent?from=` | 发件记录列表 |
| GET | `/api/sent/:id` | 发件详情 |
| DELETE | `/api/sent/:id` | 删除发件记录 |

### 管理员接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT | `/api/admin/settings` | 读取 / 更新系统设置 |
| GET/POST | `/api/admin/users` | 用户列表 / 创建用户 |
| PATCH/DELETE | `/api/admin/users/:id` | 修改 / 删除用户 |
| POST | `/api/admin/users/assign` / `unassign` | 分配 / 收回邮箱 |
| GET | `/api/admin/mailboxes` | 全部邮箱（含归属、邮件数） |
| GET | `/api/admin/mailboxes/:id/emails` | 指定邮箱邮件 |
| GET | `/api/admin/sent/daily` | 全站每日发件统计（对照 Resend 配额） |
| GET | `/api/admin/sent` | 全站发件流水 |
| GET | `/api/admin/sent/:id` | 指定发件详情 |
| GET/POST | `/api/admin/invites` | 邀请码列表 / 生成 |
| DELETE | `/api/admin/invites/:id` | 吊销邀请码 |
| GET/POST | `/api/admin/whitelist` | 发件白名单列表 / 添加 |
| DELETE | `/api/admin/whitelist/:id` | 删除白名单条目 |

### Catch-all / 白名单说明

对「收件地址在系统内不存在」的邮件，后端按一种模式处理，默认**关闭**（直接丢弃）：

- **关闭（off）**：不存在邮箱的信直接丢弃（推荐默认，防刷量/防爆存储）
- **白名单（whitelist）**：只有发件方域名后缀命中白名单才接收；`*` 表示匹配任意发件方。
  命中后转入条目指定的目标邮箱，或回退到全局 `catchall_target`
- **全放开（all）**：任意发件方都转入全局目标邮箱 `catchall_target`

开关配置项：`catchall_mode`（`off`/`whitelist`/`all`）、全局目标 `catchall_target`。
目标邮箱必须是系统内已存在的 `mailboxes.address`（前台请用管理后台的下拉选择该账户名下的邮箱）。

---

## 本地开发

```bash
# 本地起后端
npx wrangler dev

# 本地初始化数据库
npx wrangler d1 execute mail-db --local --file=schema.sql
```
