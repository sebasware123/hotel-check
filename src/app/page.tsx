"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import {
  ArrowDownUp, ArrowRight, ArrowUpRight, CalendarDays, Check,
  ChevronDown, CircleHelp, Clock3, Cloud, Code2, Copy, Heart, LoaderCircle,
  MapPin, SlidersHorizontal, Sparkles, Star, Terminal, X,
} from "lucide-react";

type Property = {
  id: number;
  title: string;
  location: string;
  price_per_night: number;
  image_url: string;
  lat: number;
  lng: number;
};

type BusyRange = { check_in: string; check_out: string };
type Attempt = { id: number; status: number | "ERR"; latency: number; message: string; time: string };

const FALLBACK_IMAGES = [
  "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=1000&q=85",
  "https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=1000&q=85",
  "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1000&q=85",
  "https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=1000&q=85",
  "https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1000&q=85",
  "https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=1000&q=85",
];

const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const isoDate = (date: Date) => format(date, "yyyy-MM-dd");

export default function HomePage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [busyRanges, setBusyRanges] = useState<BusyRange[]>([]);
  const [selected, setSelected] = useState<Property | null>(null);
  const [search, setSearch] = useState("");
  const [maxPrice, setMaxPrice] = useState(800000);
  const [sortBy, setSortBy] = useState<"recommended" | "price">("recommended");
  const [userName, setUserName] = useState("");
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [pageError, setPageError] = useState("");
  const [loadingProperties, setLoadingProperties] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingNotice, setBookingNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [range, setRange] = useState<DateRange | undefined>();
  const [stressRunning, setStressRunning] = useState(false);
  const [stressStarted, setStressStarted] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [settled, setSettled] = useState(0);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [avgMs, setAvgMs] = useState<number | null>(null);
  const [stressRunID, setStressRunID] = useState("");
  const [resettingTest, setResettingTest] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let name = localStorage.getItem("casa-clara-user");
    if (!name) {
      name = `User_${Math.floor(1000 + Math.random() * 9000)}`;
      localStorage.setItem("casa-clara-user", name);
    }
    setUserName(name);
  }, []);

  const loadProperties = useCallback(async () => {
    setLoadingProperties(true);
    setPageError("");
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("location", search.trim());
      if (maxPrice < 800000) params.set("max_price", String(maxPrice));
      const response = await fetch(`/api/properties?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("No pudimos cargar las propiedades.");
      const data = (await response.json()) as Property[];
      setProperties(sortBy === "price" ? [...data].sort((a, b) => a.price_per_night - b.price_per_night) : data);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Error inesperado al cargar propiedades.");
    } finally {
      setLoadingProperties(false);
    }
  }, [search, maxPrice, sortBy]);

  useEffect(() => { void loadProperties(); }, [loadProperties]);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch("/backend-healthz", { cache: "no-store" });
        if (active) setHealth(response.ok ? "online" : "offline");
      } catch { if (active) setHealth("offline"); }
    };
    void check();
    const timer = window.setInterval(check, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const openProperty = async (property: Property) => {
    setSelected(property);
    setRange(undefined);
    setBusyRanges([]);
    setBookingNotice(null);
    setAvailabilityLoading(true);
    try {
      const response = await fetch(`/api/properties/${property.id}/availability`, { cache: "no-store" });
      if (!response.ok) throw new Error("No pudimos consultar las fechas ocupadas.");
      const data = await response.json();
      setBusyRanges(Array.isArray(data.busy_ranges) ? data.busy_ranges : []);
    } catch (error) {
      setBookingNotice({ kind: "error", text: error instanceof Error ? error.message : "Error al consultar disponibilidad." });
    } finally { setAvailabilityLoading(false); }
  };

  const blockedDay = useCallback((date: Date) => busyRanges.some(({ check_in, check_out }) => {
    const day = startOfDay(date).getTime();
    return day >= parseISO(check_in).getTime() && day < parseISO(check_out).getTime();
  }), [busyRanges]);

  const overlapsBooking = (from: Date, to: Date) => busyRanges.some(({ check_in, check_out }) =>
    from < parseISO(check_out) && to > parseISO(check_in));

  const stayNights = useMemo(() => range?.from && range.to ? differenceInCalendarDays(range.to, range.from) : 0, [range]);
  const selectedNights = selected && stayNights > 0 ? selected.price_per_night * stayNights : 0;

  const submitBooking = async (user: string) => {
    if (!selected || !range?.from || !range.to || stayNights < 1) throw new Error("Selecciona fechas válidas.");
    if (overlapsBooking(range.from, range.to)) throw new Error("El rango se cruza con fechas ya ocupadas.");
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: selected.id, user_name: user, check_in: isoDate(range.from), check_out: isoDate(range.to) }),
    });
    if (response.status === 409) throw new Error("Estas fechas acaban de reservarse. Elige otro rango.");
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error ?? "No se pudo completar la reserva.");
    }
    return response.json();
  };

  const reserveNow = async () => {
    setBookingNotice(null);
    setBookingLoading(true);
    try {
      await submitBooking(userName || "User_0000");
      setBookingNotice({ kind: "success", text: "¡Reserva confirmada! Te esperamos." });
      if (selected) {
        const response = await fetch(`/api/properties/${selected.id}/availability`, { cache: "no-store" });
        if (response.ok) setBusyRanges((await response.json()).busy_ranges ?? []);
      }
    } catch (error) {
      setBookingNotice({ kind: "error", text: error instanceof Error ? error.message : "No se pudo completar la reserva." });
    } finally { setBookingLoading(false); }
  };

  const runStress = async () => {
    if (!range?.from || !range.to || !selected || stayNights < 1 || overlapsBooking(range.from, range.to)) {
      setBookingNotice({ kind: "error", text: "Selecciona un rango libre y válido antes de lanzar la prueba." });
      return;
    }
    setStressRunning(true);
    setStressStarted(true);
    setAttempts([]);
    setSettled(0);
    setTotalMs(null);
    setAvgMs(null);
    const runID = crypto.randomUUID().replaceAll("-", "");
    setStressRunID(runID);
    const startedAt = performance.now();
    const durations: number[] = [];
    const requests = Array.from({ length: 50 }, (_, index) => {
      const requestStarted = performance.now();
      return submitBooking(`Stress_${runID}_${index + 1}`).then(
        (body) => ({ status: 201 as const, message: `Reserva ${body.id} confirmada`, latency: performance.now() - requestStarted }),
        async (error: unknown) => {
          const message = error instanceof Error ? error.message : "Error de red";
          const status = message.includes("acaban de reservarse") ? 409 as const : "ERR" as const;
          return { status, message: status === 409 ? "Conflicto: fechas ocupadas" : message, latency: performance.now() - requestStarted };
        },
      ).then((result) => {
        durations.push(result.latency);
        setAttempts((current) => [{ id: index + 1, status: result.status, latency: result.latency, message: result.message, time: new Date().toLocaleTimeString("es-CO", { hour12: false }) }, ...current].slice(0, 50));
        setSettled((current) => current + 1);
        setAvgMs(durations.reduce((sum, value) => sum + value, 0) / durations.length);
        return result;
      });
    });
    await Promise.allSettled(requests);
    setTotalMs(performance.now() - startedAt);
    setStressRunning(false);
    if (selected) {
      try {
        const response = await fetch(`/api/properties/${selected.id}/availability`, { cache: "no-store" });
        if (response.ok) setBusyRanges((await response.json()).busy_ranges ?? []);
      } catch {
        setBookingNotice({ kind: "error", text: "La prueba terminó, pero no pudimos actualizar las fechas ocupadas." });
      }
    }
  };

  const clearStressResults = async () => {
    if (!stressRunID) return;
    setResettingTest(true);
    try {
      const response = await fetch("/api/demo-reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: stressRunID }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "No se pudieron limpiar las reservas de prueba.");
      setBookingNotice({ kind: "success", text: `${payload?.deleted ?? 0} reserva(s) de esta prueba eliminadas.` });
      if (selected) {
        const availability = await fetch(`/api/properties/${selected.id}/availability`, { cache: "no-store" });
        if (availability.ok) setBusyRanges((await availability.json()).busy_ranges ?? []);
      }
      setAttempts([]); setSettled(0); setStressStarted(false); setTotalMs(null); setAvgMs(null); setStressRunID("");
    } catch (error) {
      setBookingNotice({ kind: "error", text: error instanceof Error ? error.message : "Error limpiando la prueba." });
    } finally { setResettingTest(false); }
  };

  const confirmed = attempts.filter((attempt) => attempt.status === 201).length;
  const conflicts = attempts.filter((attempt) => attempt.status === 409).length;
  const errors = attempts.filter((attempt) => attempt.status === "ERR").length;
  const grafanaUrl = process.env.NEXT_PUBLIC_GRAFANA_DASHBOARD_URL;

  return (
    <main className="min-h-screen bg-white text-ink">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <a href="#inicio" className="flex items-center gap-3" aria-label="Casa Clara inicio">
            <span className="brand-mark"><span /></span>
            <span className="text-[19px] font-bold tracking-[-0.06em]">casa<span className="text-coral">.</span>clara</span>
          </a>
          <div className="hidden items-center gap-2 rounded-full border border-line px-4 py-2 text-xs font-semibold text-muted sm:flex">
            <span className={`status-dot ${health === "online" ? "bg-emerald-500" : health === "offline" ? "bg-rose-500" : "bg-amber-400"}`} />
            System Status: <span className={health === "online" ? "text-forest" : health === "offline" ? "text-rose-600" : "text-amber-600"}>{health === "online" ? "Online" : health === "offline" ? "Offline" : "Checking"}</span>
          </div>
          <div className="flex items-center gap-3">
            {grafanaUrl ? <a href={grafanaUrl} target="_blank" rel="noreferrer" aria-label="Ver Dashboard en Grafana" className="flex items-center gap-1.5 text-sm font-semibold text-ink transition hover:text-coral">
              <span className="grafana-icon">◒</span><span className="hidden lg:inline">Ver Dashboard en Grafana</span><ArrowUpRight size={15} />
            </a> : <span className="hidden items-center gap-1.5 text-sm font-medium text-muted lg:flex"><span className="grafana-icon">◒</span> Métricas en preparación</span>}
            <div className="flex h-10 items-center gap-2 rounded-full border border-line px-3 text-xs font-semibold text-muted"><span className="avatar">{userName ? userName.slice(-2) : "··"}</span><span className="hidden sm:inline">{userName || "Guest"}</span></div>
          </div>
        </div>
      </header>

      <section id="inicio" className="hero-shell mx-auto max-w-[1440px] px-5 pb-5 pt-10 sm:px-8 lg:px-12 lg:pt-[58px]">
        <div className="relative flex min-h-[320px] items-end overflow-hidden rounded-[28px] bg-[#e9e8e2] px-7 py-8 sm:min-h-[360px] sm:px-12 sm:py-12 lg:min-h-[410px] lg:px-[70px]">
          <div className="hero-image" />
          <div className="hero-shade" />
          <div className="relative z-10 max-w-[590px] text-white">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/15 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[.16em] backdrop-blur-md"><Sparkles size={13} /> Lugares para sentirte en casa</div>
            <h1 className="max-w-[560px] text-[42px] font-semibold leading-[1.02] tracking-[-.055em] sm:text-[54px] lg:text-[64px]">Tu próxima historia empieza aquí.</h1>
            <p className="mt-4 max-w-[390px] text-sm leading-6 text-white/80 sm:text-base">Estancias con encanto, elegidas para que llegues y respires.</p>
          </div>
          <div className="absolute bottom-7 right-8 z-10 hidden rounded-2xl border border-white/40 bg-white/90 px-4 py-3 text-xs font-semibold text-ink shadow-soft backdrop-blur md:block"><span className="text-coral">✳</span> Curado con intención</div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 pb-20 sm:px-8 lg:px-12">
        <div className="search-bar mb-11 flex flex-col gap-3 rounded-[20px] border border-line bg-white p-3 shadow-[0_6px_25px_rgba(30,41,59,.06)] md:flex-row md:items-center md:gap-0 md:py-2.5">
          <label className="flex flex-1 items-center gap-3 px-4 py-2 md:border-r md:border-line">
            <MapPin size={18} className="text-coral" />
            <span className="flex min-w-0 flex-1 flex-col"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-muted">Destino</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="¿A dónde quieres ir?" className="w-full border-0 bg-transparent p-0 text-sm font-semibold text-ink outline-none placeholder:font-normal placeholder:text-slate-400" /></span>
          </label>
          <label className="flex flex-1 items-center gap-3 px-4 py-2 md:border-r md:border-line">
            <SlidersHorizontal size={17} className="text-coral" />
            <span className="flex min-w-0 flex-1 flex-col"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-muted">Precio máximo por noche</span><span className="flex items-center justify-between gap-4"><span className="text-sm font-semibold">{money.format(maxPrice)}</span><input type="range" min="100000" max="800000" step="25000" value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))} className="w-28 accent-[#e76f51]" aria-label="Precio máximo" /></span></span>
          </label>
          <button onClick={() => setSortBy(sortBy === "recommended" ? "price" : "recommended")} className="flex items-center justify-center gap-2 rounded-[14px] bg-[#f7f6f3] px-5 py-3 text-sm font-semibold transition hover:bg-[#efeee9] md:mx-1"><ArrowDownUp size={15} /> {sortBy === "price" ? "Menor precio" : "Orden recomendado"}<ChevronDown size={14} /></button>
        </div>

        <div className="mb-6 flex items-end justify-between gap-4">
          <div><div className="eyebrow mb-2">Selección Casa Clara</div><h2 className="text-[26px] font-semibold tracking-[-.045em] sm:text-[32px]">Encuentra tu lugar</h2></div>
          <span className="pb-1 text-sm text-muted">{loadingProperties ? "Buscando…" : `${properties.length} espacios`}</span>
        </div>

        {pageError ? <div className="notice-error mb-6"><Cloud size={18} /><span>{pageError}</span><button onClick={() => void loadProperties()} className="ml-auto underline">Reintentar</button></div> : null}
        {loadingProperties ? <div className="property-grid">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="skeleton-card"><div className="skeleton-image" /><div className="skeleton-line w-2/3" /><div className="skeleton-line w-1/2" /></div>)}</div> : properties.length ? (
          <div className="property-grid">
            {properties.map((property, index) => <PropertyCard key={property.id} property={property} image={property.image_url || FALLBACK_IMAGES[index % FALLBACK_IMAGES.length]} onOpen={() => void openProperty(property)} />)}
          </div>
        ) : <div className="empty-state"><div className="mb-3 text-3xl">⌕</div><h3 className="font-semibold">No encontramos ese rincón</h3><p className="mt-1 text-sm text-muted">Prueba con otro destino o amplía el precio máximo.</p></div>}
      </section>

      <footer className="border-t border-line bg-[#faf9f7]">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-5 py-7 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12"><span>© 2026 casa.clara · Hecho para escaparse</span><span className="flex items-center gap-2"><span className={`status-dot ${health === "online" ? "bg-emerald-500" : "bg-rose-500"}`} /> API Go {health === "online" ? "conectada" : health === "offline" ? "sin conexión" : "verificando"}<span className="mx-1 text-line">|</span><a href="/metrics" target="_blank" className="underline decoration-line underline-offset-4 hover:text-ink">Prometheus metrics</a></span></div>
      </footer>

      {selected ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="detail-title" className="detail-modal">
          <div className="modal-topline"><span className="eyebrow">ESTANCIA SELECCIONADA</span><button className="icon-button" onClick={() => setSelected(null)} aria-label="Cerrar detalle"><X size={18} /></button></div>
          <div className="detail-scroll">
            <div className="detail-gallery"><img src={selected.image_url || FALLBACK_IMAGES[(selected.id - 1) % FALLBACK_IMAGES.length]} alt={selected.title} /><div className="gallery-secondary"><img src={FALLBACK_IMAGES[(selected.id + 1) % FALLBACK_IMAGES.length]} alt="Interior de la propiedad" /><img src={FALLBACK_IMAGES[(selected.id + 2) % FALLBACK_IMAGES.length]} alt="Detalle de la estancia" /></div><span className="gallery-tag"><Sparkles size={12} /> Favorito de huéspedes</span></div>
            <div className="detail-intro"><div><div className="mb-2 flex items-center gap-1 text-xs font-bold text-amber-500"><Star size={13} fill="currentColor" /> 4.92 <span className="font-normal text-muted">· 28 reseñas</span></div><h2 id="detail-title" className="text-[26px] font-semibold leading-tight tracking-[-.045em]">{selected.title}</h2><p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><MapPin size={14} />{selected.location}</p></div><div className="text-right"><div className="text-xl font-bold tracking-tight">{money.format(selected.price_per_night)}</div><div className="text-xs text-muted">por noche</div></div></div>
            <div className="detail-content-grid">
              <div className="booking-column">
                <div className="section-heading"><div><h3>Elige tus fechas</h3><p>Las fechas ocupadas aparecen desactivadas.</p></div><CalendarDays size={19} className="text-coral" /></div>
                {availabilityLoading ? <div className="calendar-loading"><LoaderCircle size={18} className="animate-spin" /> Consultando disponibilidad…</div> : <div className="calendar-card"><DayPicker mode="range" selected={range} onSelect={(value) => { setRange(value); setBookingNotice(null); }} disabled={[{ before: startOfDay(new Date()) }, blockedDay]} numberOfMonths={1} locale={es} showOutsideDays fixedWeeks /></div>}
                <div className="date-legend"><span className="legend-dot legend-blocked" /> No disponible <span className="legend-dot legend-free" /> Disponible</div>
                {busyRanges.length > 0 ? <div className="blocked-list"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-muted">Fechas bloqueadas</span><div className="mt-2 flex flex-wrap gap-2">{busyRanges.slice(0, 4).map((busy) => <span className="date-chip" key={`${busy.check_in}-${busy.check_out}`}>{format(parseISO(busy.check_in), "d MMM", { locale: es })} — {format(parseISO(busy.check_out), "d MMM", { locale: es })}</span>)}</div></div> : null}
                <div className="price-summary"><span>{range?.from && range.to ? `${money.format(selected.price_per_night)} × ${stayNights} noches` : "Selecciona check-in y check-out"}</span><strong>{selectedNights ? money.format(selectedNights) : "—"}</strong></div>
                {bookingNotice ? <div className={bookingNotice.kind === "success" ? "notice-success mt-3" : "notice-error mt-3"}>{bookingNotice.kind === "success" ? <Check size={16} /> : <CircleHelp size={16} />}<span>{bookingNotice.text}</span></div> : null}
                <button onClick={() => void reserveNow()} disabled={bookingLoading || availabilityLoading || !range?.from || !range.to || stayNights < 1} className="reserve-button mt-4">{bookingLoading ? <><LoaderCircle size={17} className="animate-spin" /> Confirmando…</> : <>Reservar ahora <ArrowRight size={17} /></>}</button>
                <p className="mt-2 text-center text-[11px] text-muted">Sin cargos hasta confirmar tu reserva.</p>
              </div>

              <div className="sandbox-card">
                <div className="sandbox-top"><div className="sandbox-icon"><Code2 size={18} /></div><span className="sandbox-pill"><span className="status-dot bg-emerald-400" /> LIVE SANDBOX</span></div>
                <div className="mt-4"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-[#91a3af]">Engineering Sandbox</div><h3 className="mt-1 text-lg font-semibold tracking-[-.03em] text-white">Prueba de Concurrencia</h3><p className="mt-2 text-xs leading-5 text-slate-400">Lanza 50 reservas simultáneas para las mismas fechas. La API debe aceptar una y rechazar las demás.</p></div>
                <div className="stress-date-row mt-4"><CalendarDays size={14} /><span>{range?.from && range.to ? `${format(range.from, "d MMM", { locale: es })} — ${format(range.to, "d MMM yyyy", { locale: es })}` : "Selecciona fechas en el calendario"}</span><span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase">{stayNights || 0} noches</span></div>
                <button className="stress-button mt-3" onClick={() => void runStress()} disabled={stressRunning || availabilityLoading || !range?.from || !range.to || stayNights < 1}><Terminal size={16} />{stressRunning ? `Enviando ${settled}/50…` : "Simular 50 usuarios reservando estas fechas ahora"}</button>
                {stressStarted ? <>
                  <div className="stress-summary mt-4"><div className="flex items-center justify-between text-[10px] text-slate-400"><span>PROGRESO DE PETICIONES</span><span>{settled}/50</span></div><div className="progress-track mt-2"><div className="progress-fill" style={{ width: `${settled * 2}%` }} /></div><div className="mt-3 grid grid-cols-3 gap-2"><div className="result-stat"><strong className="text-emerald-400">{confirmed}</strong><span>Confirmadas (201)</span></div><div className="result-stat"><strong className="text-amber-300">{conflicts}</strong><span>Conflictos (409)</span></div><div className="result-stat"><strong className="text-rose-400">{errors}</strong><span>Errores</span></div></div><p className="mt-3 text-[10px] leading-4 text-slate-300">{confirmed} reserva{confirmed === 1 ? "" : "s"} confirmada{confirmed === 1 ? "" : "s"} (201) vs {conflicts} rechazada{conflicts === 1 ? "" : "s"} por conflicto (409){errors ? ` · ${errors} error${errors === 1 ? "" : "es"}` : ""}</p></div>
                  <div className="mt-3 grid grid-cols-2 gap-2"><div className="metric-tile"><span>LATENCIA PROMEDIO</span><strong>{avgMs === null ? "—" : `${avgMs.toFixed(0)} ms`}</strong></div><div className="metric-tile"><span>TIEMPO TOTAL</span><strong>{totalMs === null ? "En curso" : `${(totalMs / 1000).toFixed(2)} s`}</strong></div></div>
                  <div className="console-panel mt-3"><div className="console-head"><span><span className="console-lights"><i /><i /><i /></span> stress-test.log</span><span>{settled} líneas</span></div><div className="console-body">{attempts.length === 0 ? <span className="text-slate-500">Esperando respuestas…</span> : attempts.slice(0, 8).map((attempt) => <div key={attempt.id} className="console-line"><span className="text-slate-500">{attempt.time}</span><span className={attempt.status === 201 ? "text-emerald-400" : attempt.status === 409 ? "text-amber-300" : "text-rose-400"}>[{attempt.status}]</span><span className="truncate">#{attempt.id} {attempt.message}</span><span className="ml-auto shrink-0 text-slate-500">{attempt.latency.toFixed(0)}ms</span></div>)}</div></div>
                  {!stressRunning ? <button disabled={resettingTest} onClick={() => void clearStressResults()} className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-400 transition hover:text-white disabled:opacity-50">{resettingTest ? <LoaderCircle size={13} className="animate-spin" /> : <X size={13} />} Limpiar reservas de prueba</button> : null}
                </> : <div className="sandbox-footnote mt-3"><Clock3 size={13} /> Requiere fechas libres. Los resultados aparecen en tiempo real.</div>}
                <div className="sandbox-db mt-4"><span className="db-pulse" /><span>PostgreSQL · EXCLUDE USING GiST</span><span className="ml-auto">{health === "online" ? "Connected" : "Check API"}</span></div>
              </div>
            </div>
            <div className="detail-bottom"><span className="flex items-center gap-2"><span className="bottom-mark">✳</span>Una estancia que se siente tuya.</span><button onClick={() => void navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })} className="flex items-center gap-1.5 text-xs text-muted hover:text-ink">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Enlace copiado" : "Compartir"}</button></div>
          </div>
        </section>
      </div> : null}
    </main>
  );
}

function PropertyCard({ property, image, onOpen }: { property: Property; image: string; onOpen: () => void }) {
  const [saved, setSaved] = useState(false);
  return <article className="property-card group">
    <button onClick={onOpen} className="card-image-wrap" aria-label={`Ver ${property.title}`}><img className="card-image" src={image} alt={property.title} loading="lazy" /><span className="image-label"><Sparkles size={11} /> Selección especial</span></button>
    <button className={`save-button ${saved ? "is-saved" : ""}`} onClick={() => setSaved(!saved)} aria-label={saved ? "Quitar de favoritos" : "Guardar en favoritos"}><Heart size={17} fill={saved ? "currentColor" : "none"} /></button>
    <button onClick={onOpen} className="card-copy text-left"><div className="flex items-start justify-between gap-3"><div><h3 className="line-clamp-1 text-[15px] font-semibold tracking-[-.02em]">{property.title}</h3><p className="mt-1 flex items-center gap-1 text-[12px] text-muted"><MapPin size={12} />{property.location}</p></div><span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs font-semibold"><Star size={12} fill="currentColor" className="text-amber-400" />4.9</span></div><p className="mt-3 text-sm"><strong>{money.format(property.price_per_night)}</strong><span className="text-muted"> / noche</span></p><span className="card-cta">Ver disponibilidad <ArrowRight size={14} /></span></button>
  </article>;
}
