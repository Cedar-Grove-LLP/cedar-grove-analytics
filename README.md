# Cedar Grove Analytics

Legal analytics dashboard for Cedar Grove LLP — attorney utilization, client activity, and billing summaries.

## Tech Stack

- Next.js 16 (App Router) + React 19
- Tailwind CSS 4
- Firebase 12 (Firestore + Auth)
- Recharts 3, D3 7
- Lucide React icons

## Getting Started

Prereqs: Node 20+ and npm.

```bash
npm install
cp .env.local.example .env.local   # if a template exists, otherwise create .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with a `@cedargrovellp.com` Google account.

### Required environment variables

Client-side (`NEXT_PUBLIC_` prefix). Pull values from Vercel or another dev:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Server-only, used by `/api/sync-transactions` and `scripts/*.mjs` (never exposed to the browser):

- `FIREBASE_SERVICE_ACCOUNT_KEY` — Firebase Admin SDK service-account JSON
- `MERCURY_API_TOKEN` — Mercury Bank API bearer token
- `MERCURY_ACCOUNT_ID` — Mercury account ID to sync transactions from

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Run ESLint |

## Project Layout

```
src/
├── app/         # Next.js App Router pages
├── components/  # UI: charts, tables, views, shared, tooltips
├── context/     # AuthContext (Google Sign-in, admin check)
├── firebase/    # Firebase app init
├── hooks/       # Firestore fetching + analytics aggregation
└── utils/       # Constants, date math, formatters, role overrides
```

## Deployment

Deployed on Vercel. Pushing to `main` triggers a deploy; environment variables are managed in the Vercel dashboard.

## Further Reading

See [CLAUDE.md](CLAUDE.md) for architecture details, the Firestore data model, auth/admin flow, and project conventions.
