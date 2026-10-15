import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { DocumentLanguage } from "@/components/DocumentLanguage";
import { AuthProvider } from "@/contexts/AuthContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import "./globals.css";
import { translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: translate("meta.title", "fr"),
  description: translate("meta.description", "fr"),
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={cn("h-full", plusJakarta.variable, jetbrainsMono.variable)}>
      <body className="h-full font-sans antialiased">
        <AuthProvider>
          <DocumentLanguage />
          <TooltipProvider>
            <ConfirmProvider>
              {children}
              <Toaster richColors position="top-right" />
            </ConfirmProvider>
          </TooltipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
