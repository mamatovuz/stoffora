import type { Metadata } from "next";
import { ContactRoute } from "@/components/route-pages";
import { SiteShell } from "@/components/site-chrome";
export const metadata: Metadata = { title: "Bog‘lanish", description: "Staffora demo so‘rovi, hamkorlik va aloqa.", alternates: { canonical: "/contact/" } };
export default function Page() { return <SiteShell><ContactRoute /></SiteShell>; }
