import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiOrigin = (process.env.GO_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const token = process.env.DEMO_RESET_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "El reset de demo no está habilitado." }, { status: 404 });
  }

  try {
    const body = await request.json();
    const response = await fetch(`${apiOrigin}/api/bookings/stress-test/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({ error: "Respuesta inválida del API." }));
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con el API Go." }, { status: 502 });
  }
}
