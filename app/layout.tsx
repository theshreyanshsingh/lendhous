import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";

// Fonts are the brand board's Georgia and Verdana, system fonts set in globals.css; no web fonts load.
export const metadata: Metadata = {
  title: { default: "LendHous", template: "%s · LendHous" },
  description: "LendHous private lending for real estate investors.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="lendhous-theme">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
