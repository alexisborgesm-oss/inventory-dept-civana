# Inventory — React + Supabase (Vite, TypeScript)

## Quick start
1) Create a Supabase project and paste your URL and anon key in `.env` (copy from `.env.example`).
2) Open Supabase SQL editor and run `supabase/schema.sql`.
3) `npm i` then `npm run dev`.
4) Sign in with username: `super_admin` and password: `Qaz123*`.
5) Create departments, areas, categories, items, and link items to areas by inserting into `area_items` (UI for linking can be added later).

## Notes
- Session auto-logout after 15 minutes of inactivity (configurable with `VITE_SESSION_IDLE_MINUTES`).
- Admin-Catalog is only visible to `super_admin` and allows user + department overview and user CRUD.
- Catalog page allows Admin/Super to CRUD areas, categories, items.
- Create Records saves records and respects "latest by inventory_date" when computing current quantities.
- Inventory and Monthly Inventory rely on SQL views/RPCs for correctness.
- Exports use client-side XLSX.


## v2.1 Notes
- Fixed Postgres error by removing generated column in `items` and adding a trigger to enforce `article_number` when category is 'Valioso'.
- Added view `items_with_flags` exposing `is_valuable` for the UI.
- **Deploy order**:
  1) Run `supabase/schema.sql`.
  2) If you already ran an older schema and saw the error, just run `supabase/patch_v2_1.sql`.
  3) No local run required; set envs in Vercel and deploy.
