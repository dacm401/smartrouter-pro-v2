import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "SmartRouter Pro - 透明AI路由专家",
  description: "看得见思考过程、看得见成长轨迹的AI对话系统",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh"><body><Providers>{children}</Providers></body></html>;
}
