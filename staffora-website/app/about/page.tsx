import type { Metadata } from "next";
import { AboutRoute } from "@/components/route-pages";
import { SiteShell } from "@/components/site-chrome";
export const metadata: Metadata = { title: "Biz haqimizda", description: "Staffora missiyasi — O‘zbekiston biznesi uchun xodimlar boshqaruvini soddalashtirish." };
export default function Page() { return <SiteShell><AboutRoute /></SiteShell>; }
