# Jon Williams — personal site

A personal homepage, shareable career page, and public analytics dashboard built with Vite and plain HTML, CSS, and JavaScript. Fonts are served locally. There are no runtime framework dependencies, contact-form services, or API keys. See [ANALYTICS.md](ANALYTICS.md) for the Arweave analytics implementation and privacy controls.

## Run locally

Use Node.js 22.12+ (Node 24 works).

```sh
npm ci
npm run dev
```

Open the local URL printed in the terminal. The homepage is `/`; the career page is `/career/`. The old `/#career` link redirects to the new career page.

## Build and launch

```sh
npm run build
npm run preview
```

Publish **only `dist/`** to your static host. Both pages are generated as real HTML, so the career page can be linked directly and refreshed without SPA rewrites. Vite uses relative asset paths; navigation also works when the entire output is hosted under a subdirectory.

For a Git-connected static host, use `npm run build` as the build command and `dist` as the publish directory. No server or environment variables are needed. Pushing this repository to GitHub does not itself deploy the website.

Build setup follows [Vite's multi-page documentation](https://vite.dev/guide/build.html#multi-page-app).

## Deploy to Arweave locally

`deploy-personal-site.mjs` uses `arweave` + `arbundles`: signed ANS-104 files sent to **`https://up.arweave.net/tx`**, followed by an `arweave/paths` manifest. This is its only network destination. There are no alternate upload services, balance lookups, payment APIs, or top-ups.

```sh
npm run deploy:check
```

This builds the current Vite site, includes the supplied resume PDF, prepares deployment copies, and prints a local preview command. It creates neither a wallet nor upload requests. Review the generated site and `.arweave-deploy/plan.json` before publishing.

```sh
npm run deploy
```

This builds and **publishes permanently**. It creates a dedicated local wallet on the first deployment, uploads the public build assets, uploads the manifest last, and prints homepage, career, and resume URLs. Use the printed career URL with its trailing slash (`/<manifest-id>/career/`); `career/index.html` is also mapped. The homepage is the manifest's index. Unknown paths return the gateway's normal missing-page response rather than silently serving the homepage.

- Deployment copies of oversized PNG/JPEG/WebP images are compressed, with a minimum quality of 65 and a minimum attempted bounding size of 640 pixels. Originals in `imgs/` and the normal `dist/` build are untouched. The formats, transparency, aspect ratios, and orientation are preserved. Review the dry-run preview to assess image quality.
- Vite replaces spaces and other URL-sensitive characters in generated asset filenames with hyphens, while keeping source filenames unchanged. The deployment preflight rejects any remaining unsafe path (including files copied from `public/`) to avoid encoded-path mismatches on manifest gateways.
- Every payload must fit within 96 KiB, and every signed data item—including the manifest—must fit within 100 KiB. Oversized non-image files stop the deployment before any upload. There is no chunk splitting or paid fallback.
- Free acceptance remains subject to the upload service's limits and availability. A payment-required response stops immediately. Keep the dedicated deployment wallet unfunded; the script does not inspect balances or authorize payment.
- `.arweave-deploy/wallet.json` is a private key. Keep it local and backed up. The script does not use a wallet from another project, and neither the wallet nor deployment state is included in the manifest. `.arweave-deploy/` and root `wallet.json` are ignored by Git.
- Accepted asset receipts are cached in `.arweave-deploy/uploads.json`, so rerunning after an interruption reuses completed uploads with identical content and metadata. Retries within a run resend the same signed item. `.arweave-deploy/latest.json` stores the most recent accepted manifest, receipt, and URLs. Service acceptance does not mean the gateway has finished indexing or that final settlement has been independently verified.
- Each preview is a separate `.arweave-deploy/site-*` folder, so its exact files remain available for review. The manifest uploads only files from the current build, not old previews, tests, source code, or deployment state.

The script also works directly: `node deploy-personal-site.mjs --dry-run` or `node deploy-personal-site.mjs`. Run `npm run test:deploy` after building to test signing, retry behavior, size checks, payment refusal, and browser navigation/downloads through a local manifest simulation. These tests do not publish anything.

## Edit content

- `index.html`: personal story, photo album, homepage project summaries, and contact details.
- `career/index.html`: professional summary, work history, skills, AI proficiency, and resume content.
- `src/projects.js`: expanded project details and their destination links.
- `src/styles.css`: shared design system, responsive layouts, and print resume styles.
- `src/themes.css`: crisp white/blue and dark navy palettes, selected automatically with `prefers-color-scheme`. Browser preference changes apply immediately; there is no manual override or stored theme.
- `src/main.js`: project dialogs, email copying, and legacy-link compatibility.
- `public/jon-williams-resume.pdf`: the supplied `Jon_Williams_Resume_2026.pdf`, served unchanged by the career page's download link and tracked in Git.
- `scripts/resume-content.js` and `scripts/generate-resume.js`: optional tools for creating a draft from the career content at `artifacts/jon-williams-resume-draft.pdf`. They do not run during Vite startup/build or overwrite the supplied resume. PDF libraries are development tools and are not shipped as browser JavaScript.
- `imgs/`: original personal photos and other existing assets. Only referenced images enter the production build.
- Project previews use the supplied DumDumz artwork, The Eye's logo (`eyecon2.png`), and AO Alien mascot. The DumDumz are shown as assets sold on AOction House, not artwork authored by Jon; collectible numbers await confirmation.
- `imgs/the-eye-light.png` and `imgs/the-eye-dark.png`: matching static dashboard screenshots captured in September 2026 from [The Eye](https://eye-of-ao.arweave.net/). Native `<picture>` sources follow the browser theme in both the homepage and project dialog. These are snapshots, not a live metrics feed. Refresh both together with `node scripts/capture-eye.js`.
- The community operations preview groups Polkadot, Arweave, DAO Academy (`imgs/logo.png`), Sarcophagus, and Decent DAO, with the first two most prominent.
- `public/favicon.svg`: the site monogram.
- `legacy/` (local only, ignored by Git): historical source backups containing private reference contact details. These are not required to build or deploy the site.

The footer website-building invitation is on both pages. Its email link includes a website inquiry subject. Contact buttons use `mailto:` to request the visitor's configured email application. Both contact sections also provide Copy email as an alternative when no working mail handler is configured. There is no form pretending to submit to an unconfigured backend.

The resume link downloads `jon-williams-resume.pdf` directly, without opening a print dialog or requiring JavaScript. Visitors can print the saved file locally. To update the download, replace `public/jon-williams-resume.pdf` with the approved PDF, then rebuild and deploy. Vite copies this file unchanged; editing the career page does not alter it. To create a separate draft from the visible career content and inert `#resume-context` template, run `node scripts/generate-resume.js` and review `artifacts/jon-williams-resume-draft.pdf`. Browser printing still has a basic stylesheet for visitors who choose to print the web page themselves.

## Content to refine together

The career copy covers technical operations, equipment troubleshooting, customer support, community management, and leadership. AI proficiency is one tile under Skills, alongside Agentic Coding in the development skills. Official project account management includes X (Twitter) and LinkedIn. Individual PR examples were intentionally removed; visitors can explore the linked GitHub profile.

Community bot experience means selecting and configuring existing bots, not developing the bots. Keep this distinction in future edits.

Before sharing with employers, review these inherited details:

- Confirm work history since the original 2025 site, especially individual community roles and their end dates. The combined role is labeled “From Feb 2021” instead of assuming every engagement continues today.
- Confirm the original “80,000+ members” figure and the Intel role title / employment relationship.
- Add two or three recent personal apps with working links, screenshots, and concrete examples of the problem solved. The Eye has a real dashboard preview and live link; the community card highlights projects Jon has worked with.
- Add specific PC repair/building experience, certifications, or equipment expertise that you want employers to see. None have been invented.
- Confirm your preferred contact address, replace older photos if desired, and supply LinkedIn or other profiles you want linked.
- After choosing a domain, add canonical URLs, a sitemap, and a dedicated social-sharing image. Page titles and descriptions are already in place.

References are available on request; third-party private contact details from the previous site are not republished in the new site.

## Verify

The footer’s **Analytics** link opens the public Arweave dashboard. See
[ANALYTICS.md](ANALYTICS.md) for tracking fields, privacy controls, indexing
limitations, and setup. It deploys with the rest of the site; local previews do
not record visits.

```sh
npx playwright install chromium
npm run build
npm run test:analytics
npm test
npm run test:deploy
```

The tests run against the production build. They cover desktop/tablet/mobile overflow and assets, automated WCAG accessibility checks, keyboard interaction with project dialogs, career navigation and old links, clipboard success/failure, direct PDF downloads matching the supplied file, and navigation without JavaScript.
