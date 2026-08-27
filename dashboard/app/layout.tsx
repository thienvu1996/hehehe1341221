import type { Metadata } from "next";
import { AdminNav } from "../components/admin-nav";
import { BloubEyeTracker } from "../components/bloub-eye-tracker";
import { DashboardTabPersistence } from "../components/dashboard-tab-persistence";
import { ImageLightboxBridge } from "../components/image-lightbox-bridge";
import { SessionBootstrapCover } from "../components/session-bootstrap-cover";
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
        <SessionBootstrapCover />
        <SessionExpiryGuard />
        <ImageLightboxBridge />
        <DashboardTabPersistence />
        <BloubEyeTracker />
        <AdminNav />
        {children}
      </body>
    </html>
  );
}
