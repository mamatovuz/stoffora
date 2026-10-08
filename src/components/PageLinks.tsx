import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { canOpenPage } from "@/lib/permissions";
import { useAuth } from "../auth";

/**
 * Menyuda yo‘q, kamdan-kam ochiladigan sahifalarga havola (sarlavha tugmalari qatorida).
 * Faqat rolga ruxsat etilganlari ko‘rinadi.
 */
export function PageLinks({ links }: { links: [string, string, LucideIcon][] }) {
  const { user } = useAuth();
  const visible = links.filter(([path]) => user && canOpenPage(user.role, path));
  return (
    <>
      {visible.map(([path, label, Icon]) => (
        <Link key={path} className="btn" to={path}>
          <Icon size={16} /> {label}
        </Link>
      ))}
    </>
  );
}
