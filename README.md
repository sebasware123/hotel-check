# Hotel Check

Hotel Check es una demo de reservas de propiedades. Puedes buscar alojamientos, elegir fechas y reservar sin crear una cuenta. En el detalle hay una prueba que envía 50 reservas para las mismas fechas y muestra cómo responde la API.

La demo y el dashboard de Grafana estarán enlazados aquí cuando termine el despliegue.

## La reserva bajo concurrencia

La protección contra dobles reservas está en PostgreSQL. Una restricción `EXCLUDE USING gist` impide que se confirmen dos reservas solapadas para la misma propiedad. La petición ganadora recibe `201 Created`; las que chocan reciben `409 Conflict`.

El rango cuenta la noche de entrada, pero no la noche de salida (`[check_in, check_out)`). Así, una nueva reserva puede empezar el mismo día en que termina la anterior. Neon incluye la extensión `btree_gist` que necesita esta restricción.

## Probarlo en local

Necesitas Go, Node.js y una base de datos en Neon. No hace falta instalar Docker.

1. Copia `.env.example` a `.env` (`Copy-Item .env.example .env` en PowerShell o `cp .env.example .env` en Bash).
2. En `DATABASE_URL`, pega la cadena de conexión que Neon muestra en **Connect**. Déjala con `sslmode=require`. Cambia `DEMO_RESET_TOKEN` por un secreto propio.
3. Desde la raíz del proyecto, ejecuta `go mod tidy` y luego `go run .`. La API crea las tablas y carga seis propiedades si la base está vacía. Está disponible en `http://localhost:8080`.
4. En otra terminal, copia `.env.local.example` a `.env.local`. Conserva `GO_API_URL=http://localhost:8080` y pon el mismo `DEMO_RESET_TOKEN`.
5. Ejecuta `npm install` y `npm run dev`. Abre `http://localhost:3000`.

No subas `.env` ni `.env.local` a Git. Tampoco pongas secretos en variables `NEXT_PUBLIC_*`: esas variables se envían al navegador.

## Despliegue

Frontend y API se despliegan como servicios separados desde este repositorio.

**API en Render**

Conecta el repositorio como un Web Service y usa el `Dockerfile` de la raíz. Render construye la imagen en sus servidores; no necesitas Docker local. Configura `DATABASE_URL` con Neon y `DEMO_RESET_TOKEN` con el mismo secreto que usarás en Vercel. Guarda la URL pública de Render: la necesitarás para conectar el frontend y Grafana.

**Frontend en Vercel**

Importa el mismo repositorio como proyecto Next.js desde la raíz. Configura `GO_API_URL` con la URL de Render, sin barra final. Añade `NEXT_PUBLIC_CLARITY_ID` y, cuando tengas el enlace público, `NEXT_PUBLIC_GRAFANA_DASHBOARD_URL`. Si habilitas el botón para borrar reservas de prueba, configura también `DEMO_RESET_TOKEN` con el mismo valor que en Render.

Next.js reenvía las llamadas `/api/*` a Render. El navegador no accede directamente a Neon y no hace falta configurar CORS para este flujo.

## Métricas en Grafana

La API publica `/metrics` en formato Prometheus. Las métricas propias son `booking_attempts_total` (resultado de cada intento) y `booking_duration_seconds` (duración de las reservas). El dashboard listo para importar está en [`grafana/hotel-check-concurrency.json`](grafana/hotel-check-concurrency.json); muestra reservas confirmadas, conflictos y latencia.

En Grafana Cloud, agrega la URL pública de Render terminada en `/metrics` desde **Connections > Add connection > Metrics Endpoint**. Luego importa el JSON y selecciona la fuente Prometheus. Grafana consulta la API cada 60 segundos. Para dar acceso a reclutadores, guarda el dashboard y usa **Share > Share externally**.

Los contadores de `/api/stats` y Prometheus viven en la memoria de la API y vuelven a cero al reiniciarla. Para esta demo, mantén una sola instancia de backend.

## API

- `GET /api/properties?location=Cartagena&max_price=500000` lista propiedades y acepta filtros opcionales.
- `GET /api/properties/:id/availability` devuelve los rangos ocupados.
- `POST /api/bookings` crea una reserva o devuelve `409` si las fechas chocan.
- `GET /api/stats` devuelve un resumen de las reservas atendidas por esta instancia.
- `GET /metrics` entrega las métricas para Prometheus.
- `GET /healthz` sirve para comprobar que la API está activa.

El botón del panel de concurrencia puede borrar las reservas de esa prueba. La limpieza usa `DEMO_RESET_TOKEN` y elimina solo las reservas asociadas a esa corrida.

Las variables necesarias están en [`.env.example`](.env.example) para Go y [`.env.local.example`](.env.local.example) para Next.js.
