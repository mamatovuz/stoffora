import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const body = await request.json();
    const base = (process.env.STAFFORA_API_URL || "https://app.staffora.uz").replace(/\/$/, "");
    const response = await fetch(`${base}/api/public/support/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({ message: "Server javobi o‘qilmadi." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ message: "Staffora serveri bilan bog‘lanib bo‘lmadi." }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
