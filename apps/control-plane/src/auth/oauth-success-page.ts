// Mobile Safari and iOS PWAs can be flaky when an OAuth callback sets an HTTP-only
// session cookie and immediately returns another redirect. Serving a short-lived
// callback document gives WebKit time to commit the cookie before React calls
// /auth/me on the app page.
export function oauthSuccessHtml(redirectUrl: string): string {
  const escapedUrl = escapeHtmlAttribute(redirectUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="2; url=${escapedUrl}">
    <title>Sign in complete</title>
    <script>
      try {
        const storedTheme = window.localStorage.getItem('deputies-theme');
        const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        document.documentElement.dataset.theme = storedTheme === 'dark' || (storedTheme !== 'light' && systemDark)
          ? 'dark'
          : 'light';
      } catch {
        document.documentElement.dataset.theme = 'light';
      }
    </script>
    <style>
      :root {
        color-scheme: light;
        --background: #f8fafc;
        --foreground: #172033;
        --card: #ffffff;
        --muted: #536179;
        --primary: #2563eb;
        --border: #d6deea;
      }

      :root[data-theme="dark"] {
        color-scheme: dark;
        --background: #0f172a;
        --foreground: #f8fafc;
        --card: #1e293b;
        --muted: #b6c2d4;
        --primary: #93c5fd;
        --border: rgba(255, 255, 255, 0.12);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-width: 320px;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1rem;
        background: var(--background);
        color: var(--foreground);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        width: min(100%, 42rem);
        padding: 1.25rem;
        border: 1px solid var(--border);
        border-radius: 1rem;
        background: var(--card);
        box-shadow: 0 20px 50px rgba(15, 23, 42, 0.12);
      }

      .eyebrow {
        margin: 0;
        color: var(--primary);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0.45rem 0 0;
        font-size: clamp(2rem, 7vw, 3rem);
        line-height: 1;
        letter-spacing: -0.04em;
      }

      p {
        margin: 0.75rem 0 0;
        color: var(--muted);
        font-size: 0.95rem;
      }

      a { color: var(--primary); }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Deputies</p>
      <h1>Sign in complete.</h1>
      <p>Redirecting to the app. If nothing happens, <a href="${escapedUrl}">open Deputies</a>.</p>
    </main>
    <script>window.setTimeout(() => window.location.replace(${JSON.stringify(redirectUrl)}), 600);</script>
  </body>
</html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
