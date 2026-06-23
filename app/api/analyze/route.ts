import OpenAI, { toFile } from "openai";
import { SYSTEM_PROMPT, USER_INSTRUCTION } from "@/lib/prompt";

// 用 Node.js 运行时（需要文件上传 / Buffer），最长运行 60 秒
export const runtime = "nodejs";
export const maxDuration = 60;

const client = new OpenAI({
  apiKey: process.env.MOONSHOT_API_KEY,
  baseURL: "https://api.moonshot.cn/v1",
});

const MODEL = process.env.MOONSHOT_MODEL || "moonshot-v1-auto";

// 允许的文件类型与大小（Vercel 免费版请求体上限约 4.5MB）
const MAX_SIZE = 20 * 1024 * 1024; // 20MB（本地宽松，线上以 Vercel 限制为准）
const ALLOWED_EXT = [".pdf", ".doc", ".docx"];

export async function POST(req: Request) {
  try {
    if (!process.env.MOONSHOT_API_KEY) {
      return jsonError("服务器未配置 MOONSHOT_API_KEY，请在 Vercel 环境变量中设置。", 500);
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return jsonError("没有收到文件，请重新上传。", 400);
    }

    const name = file.name.toLowerCase();
    if (!ALLOWED_EXT.some((ext) => name.endsWith(ext))) {
      return jsonError("只支持 PDF、Word（.doc/.docx）格式的教案文件。", 400);
    }
    if (file.size > MAX_SIZE) {
      return jsonError("文件太大了，请控制在 20MB 以内。", 400);
    }

    // 1) 把文件上传给 Kimi，让它自动解析出文本（支持 pdf/doc/docx 等）
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadable = await toFile(buffer, file.name);
    const uploaded = await client.files.create({
      file: uploadable,
      // Moonshot 专用 purpose，类型里没有所以 cast
      purpose: "file-extract" as unknown as "assistants",
    });

    // 2) 取回解析后的文本内容
    const contentResp = await client.files.content(uploaded.id);
    const fileContent = await contentResp.text();

    // 用完即删，避免在 Moonshot 侧堆积文件（失败不影响主流程）
    client.files.del(uploaded.id).catch(() => {});

    // 3) 把「系统提示词 + 教案内容 + 分析指令」发给 Kimi，流式返回
    const stream = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: fileContent },
        { role: "user", content: USER_INSTRUCTION },
      ],
    });

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
    const message = err instanceof Error ? err.message : "未知错误";
    return jsonError("分析失败：" + message, 500);
  }
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
