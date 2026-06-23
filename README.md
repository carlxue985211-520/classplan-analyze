# 教案分析助手 classplan-analyze

上传课堂教案（PDF / Word），由 Kimi（Moonshot AI）按内置提示词进行智能分析并返回结果。

## 技术栈

- Next.js 14（App Router）+ TypeScript
- Kimi / Moonshot 文件解析接口（`purpose=file-extract`）+ 对话接口（OpenAI 兼容）
- 部署在 Vercel

## 本地开发

```bash
conda activate aicoding_2026      # 本机的 node 在这个环境里
cp .env.example .env.local         # 填入你的 MOONSHOT_API_KEY
npm install
npm run dev                        # 打开 http://localhost:3000
```

## 部署到 Vercel

1. 把代码推到 GitHub（仓库：classplan-analyze）。
2. 在 [vercel.com](https://vercel.com) 用 GitHub 登录，点 **Add New → Project**，导入该仓库。
3. 在 **Environment Variables** 里添加：
   - `MOONSHOT_API_KEY` = 你的 Kimi API Key
   - `MOONSHOT_MODEL` = `moonshot-v1-auto`（可选）
4. 点 **Deploy**，等待完成即可获得线上网址。
   - 之后每次 `git push`，Vercel 会自动重新部署。

## 自定义分析提示词

编辑 [`lib/prompt.ts`](lib/prompt.ts) 里的 `SYSTEM_PROMPT` 和 `USER_INSTRUCTION`，
保存后推送到 GitHub，Vercel 会自动更新。

## 注意事项

- API Key 只配置在服务端环境变量，**不要**写进前端代码。
- Vercel 免费版单次请求体上限约 4.5MB，函数最长运行 60 秒；教案文件一般远小于此。
