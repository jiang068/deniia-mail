# Deniia Mail — Frontend

Deniia Mail 的网页前端，纯原生 HTML + JavaScript，无框架依赖。  
连接 Cloudflare Worker 后端，提供网页邮箱操作界面。

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
- **服务器配置**：首次访问时填写后端 URL，随时可修改

---

## 技术栈

| 组件 | 技术 |
|------|------|
| UI | 原生 HTML5 + Tailwind CSS (CDN) |
| 交互 | 原生 JavaScript (ES6) |
| 存储 | 浏览器 localStorage（token、API 地址） |
| 部署 | 任意静态托管（http-server / Pages / S3 / 自建） |

---

## 部署教程

### 方式一：本地开发

```bash
# 任意 HTTP Server 启动
npx http-server .

# 浏览器访问 http://localhost:8080
```

首次打开会弹出配置框，填入后端 Worker URL（如 `https://webmail-backend.xxxxx.workers.dev`）。  
URL 会存入浏览器 `localStorage`，下次访问不再提示。

### 方式二：Cloudflare Pages

```bash
# 1. 安装 Wrangler（如果未安装）
npm install -g wrangler

# 2. 登录
npx wrangler login

# 3. 部署到 Pages
npx wrangler pages deploy .

# 或通过 Dashboard 手动上传 frontend/ 目录
```

部署后首次访问同样会在浏览器中弹出配置框。

### 方式三：任意静态托管

将 `frontend/` 目录下所有文件上传到任意 HTTP 服务器或 CDN（如 Vercel、Netlify、GitHub Pages、S3 等）即可。

---

## 配置说明

**前端没有任何硬编码的 URL 或密钥。**

后端地址通过浏览器弹出框输入后保存在 `localStorage` 中，键名为 `deniia_api_base`。

### 重新配置

- 登录页底部有 **Server Settings** 链接
- 主界面顶部有 **Server** 链接
- 随时点击可修改后端 URL

### 手动设置（跳过弹出框）

打开浏览器开发者工具 → Console，执行：

```js
localStorage.setItem('deniia_api_base', 'https://你的worker地址')
```

然后刷新页面即可。

---

## 项目文件

```
frontend/
├── index.html      # 主页面（Tailwind CSS 样式、所有 UI 结构）
├── app.js          # 全部交互逻辑（API 调用、状态管理、视图切换）
└── .gitignore      # 忽略缓存和配置文件
```

- 所有代码在单个 HTML + 单个 JS 中，无构建步骤
- Tailwind CSS 通过 CDN 加载，无需安装
- 无需 Node.js 即可运行

---

## 本地开发说明

```bash
# 启动 HTTP 服务器
npx http-server -p 8080

# 打开 http://localhost:8080
# 首次填写后端 Worker URL
```

如需在开发时清除所有本地数据：

```js
localStorage.clear()
```

然后刷新页面即可重新配置。