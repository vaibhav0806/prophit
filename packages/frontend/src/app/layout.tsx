import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { Providers } from "./providers";
import { ConnectButton } from "@/components/connect-button";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Prophit",
  description: "Arbitrage trading dashboard",
};

const navItems = [
  { href: "/scanner", label: "Scanner" },
  { href: "/positions", label: "Positions" },
  { href: "/agent", label: "Agent" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950 text-gray-100`}
      >
        <Providers>
          <div className="flex min-h-screen">
            <aside className="w-64 border-r border-gray-800 bg-gray-950 flex flex-col shrink-0">
              <div className="p-6 border-b border-gray-800">
                <h1 className="text-xl font-bold tracking-tight">
                  <span className="text-emerald-400">Prophit</span>
                </h1>
                <p className="text-xs text-gray-500 mt-1">Arbitrage Dashboard</p>
                <div className="mt-3">
                  <ConnectButton />
                </div>
              </div>
              <nav className="flex-1 p-4 space-y-1">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block px-3 py-2 rounded-md text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-900 transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </aside>
            <main className="flex-1 p-8 overflow-auto">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
