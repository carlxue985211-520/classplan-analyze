import OpenAI from "openai";
import { SYSTEM_PROMPT, USER_INSTRUCTION } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

// 懒加载：只在收到请求时才创建 client，避免构建期因缺少 key 而报错
function getClient() {
  return new OpenAI({
    apiKey: process.env.MOONSHOT_API_KEY,
    baseURL: "https://api.moonshot.cn/v1",
    // SDK 自带的自动重试（针对 429/5xx），再叠加下面的手动退避
    maxRetries: 3,
    timeout: 50_000,
  });
}

const MODEL = process.env.MOONSHOT_MODEL || "moonshot-v1-auto";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 针对 Kimi「引擎繁忙(429)」做指数退避重试，最多 4 次
async function createWithRetry(
  client: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await client.chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        stream: true,
        messages,
      });
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      // 仅对「繁忙/限流(429)」和服务端错误(5xx)重试
      if (status === 429 || (status && status >= 500)) {
        await sleep(800 * Math.pow(2, attempt)); // 0.8s, 1.6s, 3.2s, 6.4s
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  try {
    if (!process.env.MOONSHOT_API_KEY) {
      return jsonError("服务器未配置 MOONSHOT_API_KEY，请在 Vercel 环境变量中设置。", 500);
    }

    // 前端已在浏览器里把 PDF/Word 解析成纯文本，这里只接收文本（payload 很小）
    const body = (await req.json().catch(() => null)) as
      | { text?: string; filename?: string }
      | null;
    const text = body?.text?.trim();

    if (!text || text.length < 10) {
      return jsonError("没有收到有效的教案文本，请重新上传文件。", 400);
    }

    const client = getClient();

    const stream = await createWithRetry(client, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: text },
      { role: "user", content: USER_INSTRUCTION },
    ]);

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || "";
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode("\n\n[分析中断] " + (err as Error).message)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : "未知错误";
    if (status === 429) {
      return jsonError(
        "Kimi 当前繁忙/达到限流（429），已自动重试多次仍未成功。请过几十秒再点一次「开始分析」。",
        429
      );
    }
    return jsonError("分析失败：" + message, 500);
  }
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
