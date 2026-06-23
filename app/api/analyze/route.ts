import OpenAI from "openai";
import { SYSTEM_PROMPT, USER_INSTRUCTION } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

// 懒加载：只在收到请求时才创建 client，避免构建期因缺少 key 而报错
function getClient() {
  return new OpenAI({
    apiKey: process.env.MOONSHOT_API_KEY,
    baseURL: "https://api.moonshot.cn/v1",
    maxRetries: 0, // 自己控制重试，避免 SDK 内部重试叠加耗尽 60s 导致 504
    timeout: 45_000, // 留出余量，确保在 Vercel 60s 上限前返回友好错误而非 504
  });
}

const MODEL = process.env.MOONSHOT_MODEL || "moonshot-v1-auto";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 针对 Kimi「繁忙/限流(429)」做有时间预算的重试：
// 最多用 8 秒争取连接成功，超过就立刻失败（把剩余时间留给生成，避免 60s 超时 504）
async function createWithRetry(
  client: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
) {
  const deadline = Date.now() + 8_000;
  let lastErr: unknown;
  for (;;) {
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
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (retryable && Date.now() < deadline) {
        await sleep(1500);
        continue;
      }
      throw err;
    }
  }
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
    const isTimeout = /timed out|timeout|ETIMEDOUT|ECONNRESET/i.test(message);
    if (status === 429 || (status !== undefined && status >= 500) || isTimeout) {
      return jsonError(
        "Kimi 引擎当前繁忙/响应过慢，本次未能完成。这是 Kimi 服务器侧的临时过载，和文件无关。请过一两分钟、或避开高峰时段再点一次「开始分析」。",
        503
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
