export interface DataJamBrowserOptions {
  endpoint?: string;
  trackPageViews?: boolean;
  trackClicks?: boolean | "marked-only";
}

export interface DataJamBrowserEvent {
  eventName: string;
  eventType?: "page_view" | "click" | "custom";
  path?: string;
  url?: string;
  title?: string;
  properties?: Record<string, unknown>;
}

interface BrowserTrackingPayload {
  anonymousId: string;
  sessionId: string;
  eventName: string;
  eventType: "page_view" | "click" | "custom";
  path: string;
  url: string;
  title: string;
  referrer: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  properties: Record<string, unknown>;
  userAgent: string;
  language: string;
  screenWidth: number;
  screenHeight: number;
  occurredAt: string;
}

let currentOptions: Required<DataJamBrowserOptions> = {
  endpoint: "/datajam/events",
  trackPageViews: true,
  trackClicks: "marked-only"
};

let hasInitialized = false;

export function initDataJam(options: DataJamBrowserOptions = {}): void {
  currentOptions = {
    ...currentOptions,
    ...options,
    trackPageViews: options.trackPageViews ?? currentOptions.trackPageViews,
    trackClicks: options.trackClicks ?? currentOptions.trackClicks
  };

  if (hasInitialized) {
    return;
  }
  hasInitialized = true;

  if (currentOptions.trackPageViews) {
    trackPageView();
    patchHistoryMethod("pushState");
    patchHistoryMethod("replaceState");
    window.addEventListener("popstate", () => trackPageView());
  }

  if (currentOptions.trackClicks) {
    document.addEventListener("click", handleClick, { capture: true });
  }
}

export function track(eventName: string, properties: Record<string, unknown> = {}): void {
  sendEvent({
    eventName,
    eventType: "custom",
    properties
  });
}

export function trackPageView(properties: Record<string, unknown> = {}): void {
  sendEvent({
    eventName: "page_view",
    eventType: "page_view",
    properties
  });
}

function handleClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const markedElement = target?.closest<HTMLElement>("[data-dj-click], [data-datajam-event]");
  if (!markedElement) {
    return;
  }

  const eventName =
    markedElement.dataset.djClick ?? markedElement.dataset.datajamEvent ?? "element_clicked";
  sendEvent({
    eventName,
    eventType: "click",
    properties: {
      tagName: markedElement.tagName.toLowerCase(),
      id: markedElement.id || undefined,
      text: markedElement.textContent?.trim().slice(0, 120) || undefined
    }
  });
}

function sendEvent(event: DataJamBrowserEvent): void {
  const payload = buildPayload(event);
  const body = JSON.stringify({ events: [payload] });

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(currentOptions.endpoint, blob);
    return;
  }

  void fetch(currentOptions.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  });
}

function buildPayload(event: DataJamBrowserEvent): BrowserTrackingPayload {
  const params = new URLSearchParams(window.location.search);
  return {
    anonymousId: getOrCreateId("datajam_anonymous_id"),
    sessionId: getOrCreateSessionId(),
    eventName: event.eventName,
    eventType: event.eventType ?? "custom",
    path: event.path ?? window.location.pathname,
    url: event.url ?? sanitizeUrl(window.location.href),
    title: event.title ?? document.title,
    referrer: document.referrer,
    source: params.get("utm_source") ?? inferSource(document.referrer),
    medium: params.get("utm_medium") ?? inferMedium(document.referrer),
    campaign: params.get("utm_campaign"),
    properties: event.properties ?? {},
    userAgent: navigator.userAgent,
    language: navigator.language,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    occurredAt: new Date().toISOString()
  };
}

function getOrCreateId(key: string): string {
  const existing = window.localStorage.getItem(key);
  if (existing) {
    return existing;
  }

  const id = crypto.randomUUID();
  window.localStorage.setItem(key, id);
  return id;
}

function getOrCreateSessionId(): string {
  const key = "datajam_session_id";
  const timestampKey = "datajam_session_last_seen";
  const now = Date.now();
  const lastSeen = Number(window.sessionStorage.getItem(timestampKey) ?? 0);
  const existing = window.sessionStorage.getItem(key);

  if (existing && now - lastSeen < 30 * 60 * 1000) {
    window.sessionStorage.setItem(timestampKey, String(now));
    return existing;
  }

  const id = crypto.randomUUID();
  window.sessionStorage.setItem(key, id);
  window.sessionStorage.setItem(timestampKey, String(now));
  return id;
}

function sanitizeUrl(url: string): string {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (/token|secret|password|email|code|session/i.test(key)) {
      parsed.searchParams.set(key, "[redacted]");
    }
  }
  return parsed.toString();
}

function inferSource(referrer: string): string | null {
  if (!referrer) {
    return "direct";
  }

  const hostname = new URL(referrer).hostname.replace(/^www\./, "");
  if (hostname.includes("google.")) {
    return "google";
  }
  if (hostname.includes("x.com") || hostname.includes("twitter.com")) {
    return "x";
  }
  if (hostname.includes("instagram.com")) {
    return "instagram";
  }
  return hostname;
}

function inferMedium(referrer: string): string | null {
  if (!referrer) {
    return "none";
  }
  return inferSource(referrer) === "google" ? "organic" : "referral";
}

function patchHistoryMethod(method: "pushState" | "replaceState"): void {
  const original = window.history[method];
  window.history[method] = function patchedHistoryMethod(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null
  ): void {
    original.call(this, data, unused, url);
    queueMicrotask(() => trackPageView());
  };
}
