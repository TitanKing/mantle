import localFont from 'next/font/local';

/**
 * Global sans-serif UI font. Self-hosted Inter variable font from
 * `/public/Inter/` — no external font CDN dependency at runtime, which
 * matches Mantle's self-hosted ethos. `variable: "--font-sans"` wires it
 * into the Tailwind theme (see globals.css @theme inline) and is applied
 * on <body> in app/layout.tsx.
 */
export const fontSans = localFont({
  variable: '--font-sans',
  display: 'swap',
  preload: true,
  fallback: [
    'ui-sans-serif',
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'Roboto',
    'Helvetica Neue',
    'Arial',
    'Noto Sans',
    'sans-serif',
  ],
  src: [
    {
      path: '../public/Inter/Inter-VariableFont_opsz,wght.ttf',
      style: 'normal',
      weight: '100 900',
    },
    {
      path: '../public/Inter/Inter-Italic-VariableFont_opsz,wght.ttf',
      style: 'italic',
      weight: '100 900',
    },
  ],
});

/**
 * Display/logo font — used only for the "Mantle" wordmark. Self-hosted
 * Bukhari Script. Exposed as `--font-logo` (mapped to the `font-logo`
 * utility in globals.css @theme inline).
 */
export const fontLogo = localFont({
  variable: '--font-logo',
  display: 'swap',
  src: [
    {
      path: '../public/fonts/BukhariScript-Regular.ttf',
      style: 'normal',
      weight: '400',
    },
  ],
});
