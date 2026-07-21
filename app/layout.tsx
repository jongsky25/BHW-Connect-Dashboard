import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { FooterGate } from "@/components/layout/footer-gate";
import { SpotFeedback } from "@/components/feedback/spot-feedback";
import { PageViewLogger } from "@/components/analytics/page-view-logger";
import { NoFlashScript } from "@/components/settings/no-flash-script";
import { SettingsProvider } from "@/components/settings/settings-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://bhw-connect-jongsky25s-projects.vercel.app"),
  title: {
    default: "BHW Connect",
    template: "%s · BHW Connect",
  },
  description:
    "A public, open-access dashboard for the Philippine Barangay Health Worker (BHW) dataset.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <NoFlashScript />
      </head>
      <body className="flex min-h-full flex-col">
        <SettingsProvider>
          <NuqsAdapter>
            <Suspense fallback={null}>
              <PageViewLogger />
            </Suspense>
            <a href="#main-content" className="skip-link">
              Skip to main content
            </a>
            <Header />
            <main id="main-content" className="flex flex-1 flex-col">
              {children}
            </main>
            <FooterGate>
              <Footer />
            </FooterGate>
            <SpotFeedback />
          </NuqsAdapter>
        </SettingsProvider>
      </body>
    </html>
  );
}
