import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ConfirmProvider } from "@/components/ConfirmDialog";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "שיבוץ | ניהול עומס ומשימות",
  description: "מערכת שיבוץ אוטומטית ל־24 השעות הקרובות",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body className={`${heebo.variable} antialiased`}>
        <AuthProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
