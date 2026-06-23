import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小学数学教学设计评价助手",
  description: "上传课堂教案，由 DeepSeek 进行智能分析",
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
