import type { Metadata } from "next";
import { ClarityTracker } from "@/components/clarity-tracker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Casa Clara | Estancias con intención",
  description: "Explora propiedades y prueba reservas de alta concurrencia.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID;

  return (
    <html lang="es">
      <body>
        <ClarityTracker projectId={clarityId} />
        {children}
      </body>
    </html>
  );
}
