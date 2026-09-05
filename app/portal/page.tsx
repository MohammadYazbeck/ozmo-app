import type { Metadata } from "next";
import ClientPortal from "./ClientPortal";

export const metadata: Metadata = {
  title: "بوابة العملاء",
  description: "تابع المحتوى والجلسات والفواتير مع OZMO.",
  robots: { index: false, follow: false },
};

export default function PortalPage() {
  return <ClientPortal />;
}
