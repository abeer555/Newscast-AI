import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "NEWSCAST AI — Autonomous Newsroom & Podcast Studio",
  description: "AI newsroom that ingests the world's news, understands it, and turns it into broadcast-quality podcasts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
