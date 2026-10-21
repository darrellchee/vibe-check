// Next may use an internal hostname in request.url behind a server/proxy.
// The browser-facing Host is the correct boundary for same-origin checks.
export function publicHost(request: Request) {
  return (
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    new URL(request.url).host
  );
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (
      url.host === publicHost(request) &&
      url.origin === origin &&
      ["http:", "https:"].includes(url.protocol)
    );
  } catch {
    return false; // An invalid Origin remains forbidden.
  }
}

export function publicOrigin(request: Request) {
  const host = publicHost(request);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}
