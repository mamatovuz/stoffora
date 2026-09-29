import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: { fontFamily: { sans: ["Inter", "Arial", "sans-serif"] } } },
  plugins: [],
} satisfies Config;
