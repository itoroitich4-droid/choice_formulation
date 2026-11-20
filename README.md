# Choice Nutrition Feed Workspace

Internal feed and premix formulation software for Choice Nutrition staff.

| Layer | Technology |
|---|---|
| Web app (Windows + Android, installable PWA) | React + TypeScript, Vite, `vite-plugin-pwa` |
| API and formulation service | Python, FastAPI |
| Least-cost optimizer | SciPy `linprog` with the HiGHS solver |
| Database, sign-in, access rules | PostgreSQL on Supabase, Supabase Auth, row-level security |

```
frontend/   React PWA          backend/   FastAPI + optimizer + tests          supabase/migrations/   SQL
```

## How it fits together
The browser signs in with **Supabase Auth** and sends its access token to the **FastAPI** service. The API verifies the token and
runs every database request *as that user* (`SET LOCAL ROLE authenticated` plus the user's JWT claims). PostgreSQL **row-level
security** and triggers therefore enforce the rules even if the API had a bug:

* roles: `admin`, `nutritionist`, `formulator`, `viewer` (table `company_members`; unknown or inactive accounts see nothing)
* only admins/nutritionists change ingredient specifications and approve or return recipes; formulators edit only their own drafts
* approved, returned and superseded versions are immutable; approving a version supersedes the previous approved one
* production batches can only be made from an approved version; nothing can be deleted; every change is recorded in `audit_events`
* prices and analyses are snapshotted by the server when a recipe is saved or submitted (clients cannot supply them)

The optimizer works in fractions of the batch: each material is bounded by its optional **Min % / Max % inclusion limits**, every
nutrient target is a min/max constraint, and the HiGHS result is rounded to 0.1 g then checked again against the limits. Materials without a price or without a value
for a targeted nutrient are excluded and reported, never guessed. When no mix exists it tells you the best and worst each nutrient
can reach under your limits. Approved premixes can be chosen as ingredients of finished feeds.

## 1. Database (Supabase)
1. Create a Supabase project. In **Authentication > Users** invite your staff.
2. For a fresh database, run the migrations in order in the **SQL editor**: `0001_schema.sql`, `0002_seed_catalogue.sql`, `0003_feed_parameters.sql`, `0004_ingredient_catalogue.sql`, `0005_researched_ingredients.sql`, `0006_remove_unsupported_pigment_fields.sql`, `0007_editable_typical_ingredient_estimates.sql`. Keep a record of which versions have been applied.
   If you already applied 0001-0005, run `0006_remove_unsupported_pigment_fields.sql` followed by `0007_editable_typical_ingredient_estimates.sql`. If you already applied 0001-0006, run only `0007_editable_typical_ingredient_estimates.sql`. Migration 0007 fills typical feed estimates and the explicitly supplied zero fields. Edit any estimate later from Ingredients > Edit product. Proprietary premixes and branded additives remain blank where a generic matrix would be unsafe; enter their label/COA analyses there.
3. Make the first administrator: `insert into public.company_members (user_id, email, role) select id, email, 'admin' from auth.users where email = 'you@company.com';`
   After that, admins manage the team from **History & backup > Team access** (add a user's ID, email and role).
4. Enable Supabase daily backups / point-in-time recovery and test a restore.

## 2. API
```bash
cd backend
python -m venv .venv && source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # fill in DATABASE_URL, SUPABASE_URL, CORS_ORIGINS
uvicorn app.main:app --port 8000
```
Deploy anywhere that runs a container or Python (`backend/Dockerfile` is included): Render, Fly.io, Railway, Azure, a company server.
It must be reachable over HTTPS. Set `ENVIRONMENT=production`; the API then requires HTTPS Supabase/CORS URLs, verifies the JWT issuer, and disables `/docs`, `/redoc`, and `/openapi.json`.

## 3. Web app
```bash
cd frontend
cp .env.example .env        # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (publishable key only), VITE_API_URL (https://api.yourcompany...)
npm install
npm run dev                 # http://localhost:5173 (proxies /api to localhost:8000)
npm run build               # static files in dist/ - host on any HTTPS static host
```
Open the hosted address in Chrome/Edge on Windows or Chrome on Android and choose **Install app**. For a Play Store-style Android
app, wrap the hosted PWA as a Trusted Web Activity with PWABuilder or Bubblewrap (needs your own signing key).
Offline: the app shell opens offline and an unsent new recipe is kept on the device; data always comes from, and is saved to, the shared database.

## Tests
```bash
cd backend && pytest        # needs a PostgreSQL: set TEST_DATABASE_URL, apply tests/supabase_shim.sql then the migrations
```
20 tests cover role permissions, the approval workflow and versioning, premix snapshots, optimizer results and limits,
reports, and direct-database attempts to bypass the API. The browser flow (sign-in session, optimizer, approval, batch, reports) was also exercised end to end.

## Production release gate
Keep this as an internal pilot until a staging deployment has passed the API tests and frontend build, every migration has been applied in order, a backup restore has been exercised, and a qualified nutritionist has checked ingredient analyses, units, nutrient targets, and a sample recipe against supplier certificates or laboratory results. The software calculates from saved data; it does not certify a feed as safe or nutritionally adequate. Ingredient availability is not inventory tracking.

## What still needs Choice Nutrition's input
Ingredient prices, laboratory/supplier analyses, nutrient targets and premix recipes must come from company records and be
reviewed by a qualified nutritionist; the software only calculates from what is entered. Not included: restore-from-JSON
(use database backups), emailed invitations (done in Supabase), a signed APK.
