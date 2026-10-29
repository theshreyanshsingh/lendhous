import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import { ThemeProvider } from "next-themes";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Headings and the wordmark use a display serif, as on the LendHous marketing site.
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif", axes: ["opsz"] });

export const metadata: Metadata = {
  title: { default: "LendHous", template: "%s · LendHous" },
  description: "LendHous private lending for real estate investors.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="lendhous-theme">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
