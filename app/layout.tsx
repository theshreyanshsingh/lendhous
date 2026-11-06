import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";

// Fonts are the brand board's Georgia and Verdana, system fonts set in globals.css; no web fonts load.
export const metadata: Metadata = {
  title: { default: "LendHous", template: "%s · LendHous" },
  description: "LendHous private lending for real estate investors.",
  // Added to an iPhone's home screen, the portal opens full screen like an app (app/manifest.ts does the same elsewhere).
  appleWebApp: { capable: true, title: "LendHous", statusBarStyle: "default" },
};
// Cover lets the phone bars reach under the home indicator, padded by the safe-area insets.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#202B28" };

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
