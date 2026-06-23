"use client";

import { useRef, useState } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    const ok = [".pdf", ".doc", ".docx"].some((ext) =>
      f.name.toLowerCase().endsWith(ext)
    );
    if (!ok) {
      setError("只支持 PDF、Word（.doc/.docx）格式的教案文件。");
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
      const fd = new FormData();
      fd.append("file", file);

      const resp = await fetch("/api/analyze", { method: "POST", body: fd });

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
        <h1>📘 教案分析助手</h1>
        <p>上传课堂教案（PDF / Word），由 Kimi 进行智能分析</p>
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
          <div>点击选择文件，或把教案拖到这里</div>
          <div className="hint">支持 .pdf / .doc / .docx，建议小于 10MB</div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.doc,.docx"
            style={{ display: "none" }}
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        {file && <div className="filename">已选择：{file.name}</div>}

        <button className="btn" onClick={analyze} disabled={!file || loading}>
          {loading ? (
            <>
              <span className="spinner" />
              Kimi 正在分析中…
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
          <h2>分析结果</h2>
          <div className="result-box">{result}</div>
        </div>
      )}

      <div className="footer">教案分析助手 · Powered by Kimi (Moonshot AI)</div>
    </div>
  );
}
