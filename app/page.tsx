"use client";

import { useRef, useState } from "react";

// 在浏览器里把 PDF / Word(.docx) 解析成纯文本
async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  if (name.endsWith(".pdf")) {
    const pdfjs: any = await import("pdfjs-dist");
    // 用与库匹配版本的 worker（CDN），避免打包器 worker 配置问题
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it: any) => it.str || "").join(" ") + "\n";
    }
    return text;
  }

  if (name.endsWith(".docx")) {
    const mammoth: any = await import("mammoth/mammoth.browser");
    const res = await mammoth.extractRawText({ arrayBuffer: buf });
    return res.value as string;
  }

  throw new Error("不支持的格式。请上传 .pdf 或 .docx（旧版 .doc 请先用 Word 另存为 .docx）。");
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    const ok = [".pdf", ".docx"].some((ext) => f.name.toLowerCase().endsWith(ext));
    if (!ok) {
      setError("只支持 PDF 和 Word(.docx)。旧版 .doc 请先用 Word 另存为 .docx。");
      return;
    }
    setError("");
    setResult("");
    setFile(f);
  }

  async function analyze() {
    if (!file || loading) return;
    setLoading(true);
    setError("");
    setResult("");

    try {
      setStatus("正在解析文件…");
      const text = await extractText(file);

      if (!text || text.trim().length < 20) {
        throw new Error(
          "没能从文件里提取到文字，可能是扫描件或纯图片 PDF。请改用带文字层的 Word/PDF。"
        );
      }

      setStatus("DeepSeek 正在分析中…");
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, filename: file.name }),
      });

      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `请求失败（${resp.status}）`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setResult((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败，请稍后重试。");
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  function copyResult() {
    navigator.clipboard.writeText(result);
  }

  function downloadResult() {
    const blob = new Blob([result], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `教案分析-${file?.name || "结果"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="container">
      <div className="header">
        <h1>📘 小学数学教学设计评价助手</h1>
        <p>上传教学设计（PDF / Word），由 DeepSeek 按"教—学—评一致性"模型诊断</p>
      </div>

      <div className="card">
        <div
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="icon">📄</div>
          <div>点击选择文件，或把教学设计拖到这里</div>
          <div className="hint">支持 .pdf / .docx（文件大小不再受限，文字会在本地提取）</div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx"
            style={{ display: "none" }}
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        {file && <div className="filename">已选择：{file.name}</div>}

        <button className="btn" onClick={analyze} disabled={!file || loading}>
          {loading ? (
            <>
              <span className="spinner" />
              {status || "处理中…"}
            </>
          ) : (
            "开始分析"
          )}
        </button>
      </div>

      {error && <div className="error">⚠️ {error}</div>}

      {result && (
        <div className="result">
          <div className="toolbar">
            <button onClick={copyResult}>复制</button>
            <button onClick={downloadResult}>下载 .txt</button>
          </div>
          <h2>诊断报告</h2>
          <div className="result-box">{result}</div>
        </div>
      )}

      <div className="footer">小学数学教学设计评价助手 · Powered by DeepSeek</div>
    </div>
  );
}
