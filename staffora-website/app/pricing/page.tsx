import type { Metadata } from "next";
import { PricingRoute } from "@/components/route-pages";
import { SiteShell } from "@/components/site-chrome";
export const metadata: Metadata = { title: "Tariflar", description: "FREE, PRO va ENTERPRISE — biznesingizga mos Staffora tarifini tanlang." };
export default function Page() { return <SiteShell><PricingRoute /></SiteShell>; }
