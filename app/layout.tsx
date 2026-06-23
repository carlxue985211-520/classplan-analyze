import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "教案分析助手",
  description: "上传课堂教案，由 Kimi 进行智能分析",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
