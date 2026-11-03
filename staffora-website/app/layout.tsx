import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin", "cyrillic"], variable: "--font-geist", display: "swap" });
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffora.uz";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Staffora — xodimlar va davomat boshqaruvi", template: "%s | Staffora" },
  description: "Xodimlar, davomat, ish jarayonlari va korxona faoliyatini yagona platformada boshqaring.",
  keywords: ["xodimlarni boshqarish tizimi", "davomat nazorati", "HRM tizimi", "korxona boshqaruvi", "Staffora"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "uz_UZ",
    url: siteUrl,
    siteName: "Staffora",
    title: "Staffora — jamoangizni boshqarish endi ancha oson",
    description: "Davomat, xodimlar va kundalik ish jarayonlari — yagona xavfsiz platformada.",
    images: [{ url: "/og-image.svg", width: 1200, height: 630, alt: "Staffora HRM platformasi" }],
  },
  twitter: { card: "summary_large_image", title: "Staffora HRM", description: "Jamoangizni yagona platformada boshqaring.", images: ["/og-image.svg"] },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f8ff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Staffora",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS, Android",
    url: siteUrl,
    description: "Korxonalar uchun HRM va workforce management platformasi.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "UZS", category: "Free plan" },
  };
  return (
    <html lang="uz" className={geist.variable}>
      <body>
        {children}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      </body>
    </html>
  );
}
