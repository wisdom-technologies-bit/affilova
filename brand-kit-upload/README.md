# Affilova Brand Kit v1.0

Built from the supplied logo. The mark was redrawn as clean vectors (geometry fitted to your artwork, 98% overlap) and the wordmark is outlined Inter Bold, so no font install is needed. Ring thickness and the inner block are centred; your original had the inner block about 3% off-centre.

## Brand basics
- Logo green: #14A953 (RGB 20,169,83)
- Ink: #0E0F0D
- Primary buttons use green 600 (#10813F) with white text. Logo green on white is only 3.07:1, so don't put small text on it.
- Wordmark: Inter Bold, tracking -2.5%. UI font: Inter.

## Folders
- svg/  master files (use these first)
- png/  transparent PNG exports for places that can't take SVG
- web/  drop-in website files (favicon, app icons, social share image, email logos)
- tokens/  colours for Tailwind / shadcn
- preview.png  contact sheet of every variant

## Which version to use
| Background | Use |
|---|---|
| White / light grey | `*-logo-horizontal.svg` or `*-stacked.svg` |
| Dark / black | `*-reversed.svg` |
| Brand green or photo | `*-white.svg` |
| One-colour print | `*-black.svg` |
| Navbar, footer, dashboard sidebar | horizontal |
| Auth pages, onboarding, 404 | stacked |
| Favicon, app icon, avatar | `icon` / `app-icon` |

## Rules
- Clear space: half the height of the capital A on all sides.
- Minimum size: horizontal 96 px wide, stacked 80 px wide, icon 16 px.
- Never stretch, rotate, recolour, outline, add shadows or place on busy imagery.

## Upload to the repo (Next.js App Router)
| From kit | To repo path |
|---|---|
| web/icon.svg | app/icon.svg |
| web/favicon.ico | app/favicon.ico |
| web/apple-icon.png | app/apple-icon.png |
| web/opengraph-image.png | app/opengraph-image.png |
| web/twitter-image.png | app/twitter-image.png |
| web/site.webmanifest | app/manifest.webmanifest |
| web/icon-192.png, icon-512.png, icon-maskable-512.png | public/ |
| web/email/*.png | public/brand/email/ |
| svg/*.svg | public/brand/ |
| tokens/brand.css | merge into app/globals.css |
| tokens/tailwind-colors.txt | merge into tailwind.config.ts |

Steps (GitHub web): repo > Add file > Upload files > drop the files > commit. Folder paths are created automatically when you type them in the file name.

Delete afterwards: public/favicon.png, public/icon.svg (the old v0 default), public/icon-light-32x32.png, public/icon-dark-32x32.png, public/placeholder-logo.png, public/placeholder-logo.svg, and the old public/apple-icon.png. Delete public/affilova-logo.png only after the Base44 step below. It is 905 KB and used in about 33 places.

## Base44 Agent prompt (paste as is)
Replace the old logo with the new brand kit.
1. Create components/brand/logo.tsx exporting `Logo` with props: variant ("horizontal" | "stacked" | "icon"), tone ("auto" | "light" | "dark"), className. Use the SVGs in /public/brand. "auto" shows the dark-text file in light mode and the reversed file in dark mode. Always include alt="Affilova" and explicit width and height to prevent layout shift.
2. Replace every `<img src="/affilova-logo.png">` in app/ and components/ with `<Logo>`: horizontal in navbars, footers and dashboard-sidebar; stacked on auth pages, onboarding, select-role and not-found.
3. In lib/brevo.ts and app/api/payments/squad/callback/route.ts use `/brand/email/affilova-logo-email.png` (and the `-white` file on dark email headers). Remove the CSS invert filter. Email clients don't render SVG.
4. In app/layout.tsx remove the `icons` metadata entry and `generator: 'v0.app'`. The icon files in app/ are picked up automatically. Keep theme-color #14A953.
5. Do not change any other code, copy or styling. List every file changed.
