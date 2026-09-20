import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ggsocial — one desk for every brand",
  description: "Plan, approve, schedule and publish social content for all your companies from one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
