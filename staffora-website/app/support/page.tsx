import type { Metadata } from "next";
import { SupportRoute } from "@/components/route-pages";
import { SiteShell } from "@/components/site-chrome";
export const metadata: Metadata = { title: "Yordam markazi", description: "Staffora yordam markazi — savol va texnik murojaat yuboring.", alternates: { canonical: "/support/" } };
export default function Page() { return <SiteShell><SupportRoute /></SiteShell>; }
