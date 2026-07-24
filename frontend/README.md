# Deniia Mail — Frontend

Deniia Mail 的网页前端，纯原生 HTML + JavaScript，无框架依赖。  
通过 `config.json` 文件配置后端 Worker 地址，部署到任意静态托管服务即可使用。

---

## 功能

- **登录 / 注册**：用户登录或注册新账号
- **多邮箱管理**：左侧列出当前用户的所有邮箱地址，点击切换
- **邮件列表**：查看选中邮箱的邮件列表，未读标记
- **邮件详情**：查看邮件完整内容（弹出式）
- **写邮件**：发送邮件（通过后端 Resend 通道）
- **系统初始化**：首次部署无管理员时引导初始化
- **管理后台**：
  - 开关注册
  - 配置每日发件限额
  - 查看用户列表

---

## 技术栈

| 组件 | 技术 |
|------|------|
| UI | 原生 HTML5 + Tailwind CSS (CDN) |
| 交互 | 原生 JavaScript (ES6) |
| 存储 | 浏览器 localStorage（仅 token） |
| 部署 | 任意静态托管（Pages / S3 / 自建等） |

---

## 部署教程

### 1. 创建 config.json

`config.json` 已加入 `.gitignore`，不会提交到仓库。你需要手动创建它：

```json
{
  "api_base": "https://webmail-backend.xxxxx.workers.dev"
}
```

可以复制 `config.json.example` 然后修改：

```bash
cp config.json.example config.json
# 编辑 config.json，填入你的 Worker URL
```

### 2. 部署

前端可以部署到任意静态托管服务。

**Cloudflare Pages：**

```bash
npx wrangler pages deploy .
```

**其他方式：** 将 `frontend/` 下所有文件（包括 `config.json`）上传到任意 HTTP 服务器或 CDN（Vercel、Netlify、GitHub Pages、S3 等）。

> 注意：部署时必须包含 `config.json`，否则前端无法连接后端。

---

## 本地开发

```bash
# 1. 创建配置文件
cp config.json.example config.json
# 编辑 config.json，填入你的 Worker URL

# 2. 启动任意 HTTP 服务器
npx http-server .

# 3. 浏览器访问 http://localhost:8080
```

> 必须通过 HTTP 服务器访问（`file://` 协议无法加载 `config.json`）。

---

## 项目文件

```
frontend/
├── index.html                  # 主页面（Tailwind CSS 样式、所有 UI 结构）
├── app.js                      # 全部交互逻辑
├── config.json.example         # 配置模板（公开仓库）
├── config.json                 # 实际配置（已 gitignore，需手动创建）
├── .gitignore
└── README.md
```

---

## 配置说明

所有 API 地址通过 `config.json` 中的 `api_base` 字段指定，格式为后端 Worker 的根 URL（不包含 `/api` 后缀）。

```json
{
  "api_base": "https://webmail-backend.xxxxx.workers.dev"
}
```

前端启动时会自动请求 `config.json` 获取后端地址。如果文件缺失或格式错误，页面会显示配置错误提示。