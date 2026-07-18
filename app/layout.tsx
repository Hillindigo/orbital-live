import type { Metadata } from "next";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbital Live — 全球卫星实时轨迹",
  description: "基于 CelesTrak TLE 与 satellite.js 的全球卫星 3D 实时轨迹演示。",
  openGraph: {
    title: "Orbital Live — 全球卫星实时轨迹",
    description: "在浏览器中实时推算并探索超过一万颗卫星的三维轨迹。",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Orbital Live 全球卫星实时轨迹" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Orbital Live — 全球卫星实时轨迹",
    description: "CelesTrak TLE × satellite.js 实时轨道推算",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
