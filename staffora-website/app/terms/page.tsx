import type { Metadata } from "next";
import { LegalRoute } from "@/components/route-pages";
import { SiteShell } from "@/components/site-chrome";
export const metadata: Metadata = { title: "Foydalanish shartlari", description: "Staffora platformasidan foydalanish shartlari." };
export default function Page() { return <SiteShell><LegalRoute kind="terms" /></SiteShell>; }
