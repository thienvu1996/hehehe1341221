import type { Metadata } from "next";
import { SessionExpiryGuard } from "../components/session-expiry-guard";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zalo Rental Intel",
  description: "Dashboard xem du lieu Zalo bot thu thap link thue nha"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>
        <SessionExpiryGuard />
        {children}
      </body>
    </html>
  );
}
