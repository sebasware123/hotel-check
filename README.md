# Hotel Check

Demo de reservas con una API en Go, una interfaz en Next.js y PostgreSQL en Neon. El proyecto muestra cómo evitar reservas duplicadas cuando varias peticiones intentan reservar las mismas fechas.

## Para probar la demo

La app y el dashboard de métricas se publicarán después de configurar Vercel, Render y Grafana Cloud. Los enlaces públicos se agregarán aquí cuando estén disponibles.

En la app puedes explorar propiedades, seleccionar fechas y lanzar una prueba con 50 peticiones simultáneas. La API confirma una reserva y responde con conflicto a las que chocan. Microsoft Clarity registra interacciones cuando se configura su ID de proyecto.

## Cómo correrlo en tu computadora

No hace falta instalar Docker. Necesitas Go y Node.js.

1. Copia `.env.example` a `.env`. En PowerShell: `Copy-Item .env.example .env`. En Bash: `cp .env.example .env`.
2. En `.env`, pega en `DATABASE_URL` la cadena que Neon muestra en **Connect**. Conserva `sslmode=require`. Cambia también `DEMO_RESET_TOKEN` por un secreto propio.
3. En una terminal, desde esta carpeta, ejecuta `go mod tidy` y después `go run .`. La API carga `.env`, conecta con Neon, crea las tablas y agrega seis propiedades de ejemplo si la tabla está vacía. Queda disponible en `http://localhost:8080`.
4. En otra terminal, copia `.env.local.example` a `.env.local`. Deja `GO_API_URL=http://localhost:8080` y pon el mismo `DEMO_RESET_TOKEN` que configuraste en `.env`.
5. Ejecuta `npm install` y `npm run dev`. Abre `http://localhost:3000`.

No guardes credenciales en Git ni las pongas en variables `NEXT_PUBLIC_*`. Esas variables llegan al navegador.

## Cómo se evita una doble reserva

La API intenta insertar cada reserva dentro de una transacción. PostgreSQL aplica una restricción `EXCLUDE USING gist` que impide que dos reservas confirmadas de la misma propiedad compartan noches. Por eso, aunque dos peticiones lleguen a la vez, la base de datos acepta una y rechaza la otra. La API responde `201 Created` a la aceptada y `409 Conflict` a la que choca.

El rango de fechas incluye el check-in y excluye el check-out (`[check_in, check_out)`). Así, una reserva nueva puede comenzar el mismo día en que termina la anterior. Neon soporta la extensión `btree_gist`, que requiere esta restricción.

## Despliegue: Vercel, Render y Neon

Puedes desplegar frontend y backend por separado desde este mismo repositorio.

**Render (API Go)**

1. Crea un Web Service conectado al repositorio y selecciona el runtime Docker con el `Dockerfile` de la raíz.
2. Configura `DATABASE_URL` con la cadena de Neon y `DEMO_RESET_TOKEN` con un secreto largo.
3. Guarda la URL pública que Render asigna al servicio. `/healthz` debe responder `{"status":"ok"}` y `/metrics` debe mostrar métricas.

**Vercel (frontend Next.js)**

1. Importa el mismo repositorio como proyecto Next.js, usando la raíz del repositorio.
2. Configura `GO_API_URL` con la URL pública de Render, sin una barra final.
3. Configura `NEXT_PUBLIC_CLARITY_ID` y `NEXT_PUBLIC_GRAFANA_DASHBOARD_URL` cuando tengas esos enlaces. Si activas la limpieza de pruebas, configura también el mismo `DEMO_RESET_TOKEN` que usa Render.

Next.js reenvía las llamadas `/api/*` a Render. El navegador no se conecta directamente a Neon y no hace falta habilitar CORS para este flujo.

## Métricas y dashboard

La API publica `/metrics` en formato Prometheus. Incluye `booking_attempts_total` por resultado y el histograma `booking_duration_seconds`. El JSON importable está en [`grafana/hotel-check-concurrency.json`](grafana/hotel-check-concurrency.json) y muestra reservas, conflictos, latencia media y p95 (el tiempo que no supera el 95 % de las reservas).

En Grafana Cloud, agrega la URL pública de Render terminada en `/metrics` mediante **Connections > Add connection > Metrics Endpoint**. Después importa el JSON y elige la fuente Prometheus. Para compartirlo, usa **Share > Share externally** y configura el enlace público. Grafana consulta ese endpoint cada 60 segundos; por eso, la API debe estar desplegada y ser accesible desde internet.

Los contadores y `/api/stats` viven en memoria del proceso y vuelven a cero al reiniciar la API. Para esta demo, usa una instancia de backend; varias instancias necesitarían recolectar métricas de cada una.

## Endpoints principales

- `GET /api/properties?location=Cartagena&max_price=500000`: lista y filtra propiedades.
- `GET /api/properties/:id/availability`: devuelve fechas ocupadas.
- `POST /api/bookings`: crea una reserva; puede responder `201`, `409` u otro error validado.
- `GET /api/stats`: devuelve contadores del proceso actual.
- `GET /metrics`: expone métricas para Prometheus y Grafana.
- `GET /healthz`: indica si la API está activa.

El botón de limpieza del panel solo elimina reservas creadas por esa corrida de estrés. El endpoint está protegido con `DEMO_RESET_TOKEN`; configura el mismo valor en Render y Vercel.

## Configuración

La lista de variables está en [`.env.example`](.env.example) para Go y [`.env.local.example`](.env.local.example) para Next.js. No subas `.env` ni `.env.local` a Git.
