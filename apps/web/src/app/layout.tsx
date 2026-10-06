import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "SMP Analytics", template: "%s · SMP Analytics" },
  description: "Activity timeline and player statistics for our Minecraft SMP.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#090b0f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <AppHeader />
        <main id="main" className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 pb-16 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
