import type { Metadata } from "next";
import { FeaturesRoute } from "@/components/route-pages";
import { SiteShell } from "@/components/site-chrome";
export const metadata: Metadata = { title: "Imkoniyatlar", description: "Staffora HRM: davomat, xodimlar, xarita, kalendar, hisobot, ish haqi va hujjatlar." };
export default function Page() { return <SiteShell><FeaturesRoute /></SiteShell>; }
