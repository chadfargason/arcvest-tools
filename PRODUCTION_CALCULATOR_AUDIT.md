## Portfolio Calculator Production Audit

### Goal
Determine which `calculator.html` file serves the live ArcVest portfolio calculator so the team can consolidate to a single production-ready source.

### Investigation Summary
- Navigated to `https://arcvest.com/investment-tools/` and confirmed it redirects to `https://arcvest-tools.vercel.app/`.
- Followed the “Portfolio Calculator” link, which loads `https://arcvest-tools.vercel.app/calculator` and embeds `https://arcvest-tools.vercel.app/calculator.html` in an iframe.  
  - Captured the iframe source URL using browser dev tools (`document.querySelector('iframe').src`).
- Downloaded `https://arcvest-tools.vercel.app/calculator.html` locally and compared it with the two repository copies:
  1. `fargason-capital-site/public/calculator.html`
  2. `fargason-capital-platform/apps/website/public/calculator.html`
- Diffed the downloaded HTML against each file (`fc` in PowerShell).

### Findings
- The production asset (`arcvest-tools.vercel.app/calculator.html`) matches `fargason-capital-site/public/calculator.html` byte-for-byte, aside from expected line-ending/encoding noise.
  - Notable markers present in both: ArcVest design token block, fallback notice markup, and the updated API endpoint call:
    ```468:472:fargason-capital-site/public/calculator.html
        async function calculateReturns() {
          // Updated API endpoint with category fallback support (Nov 2, 2025)
          const apiEndpoint = 'https://investment-chatbot-1.vercel.app/api/portfolio/calculate';
    ```
- The copy inside `fargason-capital-platform/apps/website/public/calculator.html` is an older “Clean UI” variant that still references the `fargason-capital-platform-ttgo` API and lacks the ArcVest design updates used in production.

### Recommendation
1. Treat `fargason-capital-site/public/calculator.html` as the canonical production file.

## Deployment reminder (Nov 14, 2025)

- Any change to the portfolio calculator must be edited in `fargason-capital-site/public/calculator.html`.
- Deploy via `vercel deploy --prod` from the `fargason-capital-site` directory (this pushes to the `arcvest-tools` project, which serves `https://tools.arcvest.com/calculator`).
- After deploy, verify the live file with `curl https://tools.arcvest.com/calculator.html | Select-String 'Total US Equity'` or similar to confirm the production iframe reflects the update.
2. Remove or clearly deprecate `fargason-capital-platform/apps/website/public/calculator.html` to prevent future confusion.
3. Update internal documentation and deployment scripts to reference only the `fargason-capital-site` copy before future releases.


