import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui";
import { Acesso } from "@/components/acesso";
import "./globals.css";

export const metadata: Metadata = { title: "Operações · Lieto", description: "Inventário, produção e rotinas operacionais integradas ao Lieto", appleWebApp: { capable: true, title: "Coletor", statusBarStyle: "black-translucent" }, icons: { apple: "/icone-192.png" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#364759" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans antialiased">
        <Toaster><Acesso>{children}</Acesso></Toaster>
      </body>
    </html>
  );
}
