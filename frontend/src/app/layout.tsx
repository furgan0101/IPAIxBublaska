import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VOSTbw — OSINT Situational Awareness",
  description:
    "Automated OSINT verification dashboard for VOST Baden-Württemberg — Konstanz demo sector.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-slate-950 font-sans text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
