# Deniia Mail — Backend

Cloudflare Workers 后端，提供邮件系统的全部 API（收发、用户管理、邮箱管理）。

---

## 功能

- **邮件接收**：通过 Cloudflare Email Routing 接收邮件，自动解析并存入 D1 数据库
- **邮件发送**：集成 Resend API，支持纯文本 / HTML 发送，自动记录发件日志
- **多邮箱**：每个用户可以拥有多个邮箱地址，收发分离
- **邮件管理**：查看、删除单封邮件，清空邮箱
- **发件记录**：查询发送历史、查看详情、删除记录
- **用户系统**：注册 / 登录（Bearer Token）、角色权限（user / admin）
- **管理员后台**：
  - 系统设置（注册开关、每日发件限额）
  - 用户管理（创建、编辑角色/密码/权限、删除）
  - 邮箱分配（为用户分配或收回邮箱地址）
- **每日限额**：按用户统计每日发送量，超限自动拒绝
- **转发 / 收藏**：可设置邮箱转发目标、切换收藏状态

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers |
| 数据库 | Cloudflare D1 (SQLite) |
| 收件 | Cloudflare Email Routing |
| 发件 | Resend REST API |
| 邮件解析 | postal-mime |

---

## 前置条件

- Node.js >= 18
- [Cloudflare 账号](https://dash.cloudflare.com/)
- [Resend 账号](https://resend.com)（用于发件）

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
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 3. 配置 wrangler.toml

```bash
cp wrangler.toml.example wrangler.toml
```

编辑 `wrangler.toml`，填入：

```toml
# 上一步创建的 database_id
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# 你的域名（用于生成邮箱地址）
DOMAIN = "yourdomain.com"
```

### 4. 初始化数据库

```bash
npx wrangler d1 execute mail-db --file=schema.sql --remote
```

### 5. 配置 Resend API Key（发件必需）

```bash
npx wrangler secret put RESEND_API_KEY
```

在提示后粘贴你的 Resend API Key 并回车。

> **获取 Resend Key：**
> 1. 登录 [Resend](https://resend.com)
> 2. Domains → Add Domain → 验证你的发件域名
> 3. API Keys → Create API Key → 权限勾选 `Email: send`
> 4. 复制生成的 Key

### 6. 配置 Email Routing（收件必需）

1. Cloudflare Dashboard → **Email → Email Routing**
2. 添加域名，按提示配置 DNS（MX 记录等）
3. 创建路由规则：`*@yourdomain.com` → 转发到 Worker `webmail-backend`

确保 `wrangler.toml` 中的 `DOMAIN` 与 Email Routing 配置的域名一致。

### 7. 部署

```bash
npx wrangler deploy
```

部署成功后输出 Worker URL，形如 `https://webmail-backend.xxxxx.workers.dev`。前端需要这个地址来连接。

---

## 配置汇总

| 配置项 | 方式 | 说明 |
|--------|------|------|
| `DOMAIN` | `wrangler.toml` `[vars]` | 邮箱域名，如 `deniia.com` |
| `database_id` | `wrangler.toml` `[[d1_databases]]` | D1 数据库 ID |
| `RESEND_API_KEY` | `wrangler secret put` | Resend API Key（发件） |

`wrangler.toml` 已加入 `.gitignore`，不会提交到仓库。公开仓库只需提交 `wrangler.toml.example`。

---

## API 一览

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/check` | 检查是否存在管理员 |
| POST | `/api/admin/setup` | 首次部署初始化管理员 |
| POST | `/api/register` | 注册用户（受开关控制） |
| POST | `/api/login` | 登录，返回 Bearer token |
| GET | `/api/domains` | 可用域名列表 |

### 认证接口（需要 `Authorization: Bearer <token>`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mailboxes` | 当前用户的邮箱列表 |
| GET | `/api/mailbox/info?address=` | 邮箱详情（转发/收藏） |
| POST | `/api/mailbox/forward` | 设置转发目标 |
| POST | `/api/mailbox/favorite` | 切换收藏 |
| GET | `/api/emails?mailbox=` | 邮件列表 |
| GET | `/api/email/:id` | 邮件详情 |
| DELETE | `/api/email/:id` | 删除邮件 |
| DELETE | `/api/emails?mailbox=` | 清空邮箱 |
| GET | `/api/generate` | 随机生成邮箱 |
| POST | `/api/create` | 自定义创建邮箱 |
| GET | `/api/user/quota` | 邮箱配额 |
| POST | `/api/send` | 发送邮件（Resend） |
| GET | `/api/sent?from=` | 发件记录列表 |
| GET | `/api/sent/:id` | 发件详情 |
| DELETE | `/api/sent/:id` | 删除发件记录 |

### 管理员接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/settings` | 获取系统设置 |
| PUT | `/api/admin/settings` | 更新设置 |
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/users` | 创建用户 |
| PATCH | `/api/admin/users/:id` | 修改用户 |
| DELETE | `/api/admin/users/:id` | 删除用户 |
| POST | `/api/admin/users/assign` | 分配邮箱 |
| POST | `/api/admin/users/unassign` | 取消分配 |

---

## 本地开发

```bash
# 启动本地开发服务器
npx wrangler dev

# 本地初始化数据库
npx wrangler d1 execute mail-db --local --file=schema.sql
```