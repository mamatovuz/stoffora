import type { Metadata } from "next";
import { LegalRoute } from "@/components/route-pages";
import { SiteShell } from "@/components/site-chrome";
export const metadata: Metadata = { title: "Maxfiylik siyosati", description: "Staffora maxfiylik va ma’lumotlarni himoya qilish siyosati." };
export default function Page() { return <SiteShell><LegalRoute kind="privacy" /></SiteShell>; }
