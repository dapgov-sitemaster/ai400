import type { Metadata } from "next";
import Dashboard from "./dashboard";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "Admin dashboard | AI 402",
  robots: { index: false, follow: false, noarchive: true },
};

export default function DashboardPage() {
  return <Dashboard />;
}
