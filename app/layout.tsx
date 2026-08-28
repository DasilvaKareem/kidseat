import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Free food near you",
  description: "Get a text when there is free food near you in San Francisco and Marin.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Never block pinch-zoom — some people need it to read anything at all.
  maximumScale: 5,
  themeColor: "#fdfaf5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang is set per-element by the wizard; html stays neutral until they pick.
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
