# Packing

Packing is a lightweight web app for managing personal inventory and trip packing lists.

It was produced using GitHub Copilot.

## Features

- Maintain one or more inventories
- Organize items in nested categories
- Move items between inventory and active packing list
- Track quantities and packed status
- Create multiple named packing lists
- Import/export data as JSON
- Optional passcode-based cloud sync (Cloudflare Worker + KV)

## Tech stack

- React + TypeScript + Vite
- Cloudflare Worker (API + static asset serving)
- Cloudflare KV for synced list storage

## Getting started

```bash
npm ci
npm run dev
```

## Scripts

- `npm run dev` – start local dev server
- `npm run lint` – run ESLint
- `npm run build` – type-check and build production assets
- `npm run preview` – preview production build locally

## Deployment notes

This project is configured for Cloudflare Workers via `wrangler.toml`.

To deploy, you should:

1. Build the app (`npm run build`)
2. Ensure KV namespace bindings are configured
3. Deploy with Wrangler (for example, `wrangler deploy`)

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
