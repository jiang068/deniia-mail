# Deniia Mail

Serverless webmail system powered by Cloudflare Workers + D1 + Email Routing + Resend.

```
deniia-mail/
├── backend/          Cloudflare Worker 后端（API、收件、发件）
│   ├── README.md     部署教程、API 文档
│   ├── worker.js     源码
│   ├── schema.sql    数据库建表脚本
│   └── wrangler.toml.example  配置模板
│
├── frontend/         网页前端（原生 HTML + JS）
│   ├── README.md     部署教程
│   ├── index.html    主页面
│   └── app.js        交互逻辑
│
└── README.md         本文件
```

两个项目相互独立，分别部署。详见各子目录的 README。