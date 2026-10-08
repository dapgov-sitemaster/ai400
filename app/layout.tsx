import type { Metadata } from "next";
import "./globals.css";
import "./fonts.css";

export const metadata: Metadata = {
  title: "AI 402 | Application Portal",
  description: "Apply for Advanced Applied Artificial Intelligence for the Philippine Public Sector.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/brand/fireflai-dark.png",
    shortcut: "/brand/fireflai-dark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
