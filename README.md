# Shakti Engineering Works — website + admin dashboard

A small Node.js app that serves the public website (`index`, `about`, `process`, `products`, `blog`,
`contact`) and a dashboard at `/admin` where an admin/editor can change almost everything on the
frontend — text, images, PDFs, colours/theme, fonts, the navigation menu, custom pages, blog posts
(including AI-drafted ones), the AI chatbot's Gemini API key and behaviour, contact-form email
notifications, and user accounts.

**Storage has two interchangeable modes, auto-selected by which environment variables are set:**

| | Default (file mode) | Free-tier mode |
|---|---|---|
| When it's used | `MONGODB_URI` / `CLOUDINARY_URL` unset | either one is set |
| Database | `data/db.json` (a single JSON file, written atomically with a rolling 14-day backup in `data/backups/`) | a single document in a MongoDB Atlas collection |
| Uploaded images/PDFs | `data/uploads/` | Cloudinary |
| Fits | a VPS or any host with a real, persistent disk | a host whose free tier has **no** persistent disk (e.g. Render's free web service) |

The rest of the app (every route, the dashboard, the public site) never knows which mode is active —
both are exercised by `scripts/test-mongo-store.js` and by running `scripts/smoketest.js` against a
server started with `CLOUDINARY_URL` set (see [Running the test suite](#running-the-test-suite)).

## Requirements

- Node.js 18+ (built with Node 20). No native/compiled dependencies — `npm install` alone is enough
  on any host, including typical shared hosting.

## Run it locally

```bash
npm install
npm start          # or: node server.js
```

The first time it starts, it prints a **one-time setup code** in the console. Open `http://localhost:3000/admin`,
enter that code plus your name/email/password, and that becomes the first admin account. The code is
only valid until an admin account exists — if you lose it, restart the server (a fresh install has no
users yet) or add a user via the [db-tools](#resetting-a-forgotten-password) below.

Environment variables (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` (or `0.0.0.0` if `PORT` is set by the platform) | Bind address. |
| `DATA_DIR` | `./data` | Where `db.json`, `uploads/`, `backups/` and the encryption key live. Point this at a persistent volume/disk on your host. |
| `SECRET_KEY` | auto-generated into `data/secret.key` | Master key used to encrypt the Gemini API key and SMTP password at rest. Set this explicitly in production and keep it secret — if it's lost, saved keys can't be decrypted and must be re-entered. |
| `TRUST_PROXY` | unset | Set to `true` (or a hop count) when running behind a reverse proxy/load balancer, so rate-limiting and `req.secure` see the real client. |
| `COOKIE_SECURE` | auto (on when the request is HTTPS) | Set to `true` to force the session cookie to `Secure` even behind a proxy that terminates TLS before Node sees it. |
| `MONGODB_URI` | unset (file mode) | An Atlas (or any MongoDB) connection string. Setting this switches the database to MongoDB — see [Deploying for free](#deploying-for-free-no-card-needed). |
| `MONGODB_DB` | `shakti_cms` | Database name to use inside the Mongo cluster. Only relevant when `MONGODB_URI` is set. |
| `CLOUDINARY_URL` | unset (local disk) | A Cloudinary account's API connection string (`cloudinary://key:secret@cloud_name`, from their dashboard). Setting this switches image/PDF uploads to Cloudinary instead of local disk. |

## What the dashboard can do

- **Website content** (`Home`, `About`, `Process`, `Products`, `Blog page`, `Contact`, and
  `Header/footer & widgets`): every text string, image, alt text and link on the live pages is
  editable, grouped by section. Sections can be hidden or reordered. Each page has its own SEO
  title/description override.
- **Custom pages**: add new pages (e.g. "Careers", "Warranty") with a rich-text editor; optionally
  add them to the navigation menu.
- **Blog**: write posts by hand or generate a draft with AI (topic → title, excerpt, tags, meta
  description and a full article), edit with the rich-text editor, publish/unpublish.
- **Media library**: upload images (auto-resized/compressed, EXIF-rotated) and PDFs; every upload is
  content-sniffed by its actual bytes, not its filename, before being accepted.
- **Theme & colours**: six starting presets (including a dark one), two-click accent/secondary colour
  pickers with a live contrast warning, font pair, and corner roundness — generates `theme.css` on the
  fly, no rebuild needed.
- **Navigation menu**: reorder/rename/add/remove the top nav links.
- **AI & chatbot**: paste a Gemini API key (get one free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)),
  test it, pick a model, and configure the chatbot's name/greeting/extra knowledge. The public chat
  widget calls Gemini through the server (the key never reaches the browser) and falls back to a
  simple offline FAQ bot if AI is off, the key is missing, or Gemini errors out.
- **Email notifications**: when someone submits the contact form, the dashboard can email your team
  automatically via any SMTP account (Hostinger's own mailboxes work — see below). Every enquiry is
  also logged under **Enquiries** regardless of whether email is set up, with CSV export.
- **Users**: admins can add editor accounts (can edit content/blog/media/pages, not theme/settings/users)
  or other admins.
- **Backup**: one-click download of a JSON backup of all content/settings/users (not images — back
  those up from the Media library or your host's file manager).

## Setting up email notifications on Hostinger

1. In hPanel, create a mailbox under **Emails** (e.g. `notify@yourdomain.com`).
2. In the dashboard, go to **Email notifications** and enter:
   - Host: `smtp.hostinger.com`
   - Port `465` with **Use SSL** checked, *or* port `587` with it unchecked
   - Username/password: the mailbox's own login
   - From address: e.g. `"Shakti Engineering Works" <notify@yourdomain.com>`
3. Click **Send test email** before saving for real — it tells you immediately if the host/port/
   credentials are wrong, rather than failing silently on the next real enquiry.

## Deploying to Hostinger

Hostinger's plain **shared web hosting** only serves PHP/static files — it cannot keep a Node.js
process running. Use one of:

- **Hostinger's "Node.js" app feature** (available on Business/Cloud hosting and VPS plans, via
  hPanel → *Advanced → Node.js*): point it at this folder, set the **startup file** to `server.js`,
  and set `DATA_DIR` to a path outside the web root that Hostinger keeps persistent. Hostinger
  reverse-proxies your chosen port automatically.
- **A Hostinger VPS**: install Node 18+, copy this folder over, `npm install --omit=dev`, run it
  behind Nginx (reverse-proxy `/` to `127.0.0.1:3000`, terminate TLS with Hostinger's free SSL), and
  keep it alive with `pm2` or a systemd service so it restarts on crash/reboot.

Either way:
- Set `SECRET_KEY` to a random 32+ character string you generate once and keep safe (e.g.
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- Point `DATA_DIR` at a persistent directory and make sure your hosting backs it up (or schedule a
  cron job to copy it somewhere safe — it's the only real "database" this app has).
- The very first deploy has no users, so the setup code will print to whatever Hostinger shows as
  the app's logs — check there for it.

**On credentials:** please don't paste your Hostinger password directly in chat. Safer options: add
me as a **collaborator** on the hPanel account (if Hostinger supports it on your plan), or share
**SSH key access** / an **API token** scoped just for deployment. If none of those are available and
a password is the only option, change it right after deployment is done.

## Deploying for free (no card needed)

This is the path actually used for shaktiew.in. Three free accounts, none of which ask for a card:

1. **Code**: push this repo to a GitHub repository.
2. **Compute — [Render](https://render.com)**, free Web Service:
   - New → Web Service → connect the repo (or paste its public GitHub URL under "Public Git Repository" if you don't want to link GitHub to Render at all)
   - Build command: `npm install` · Start command: `node server.js`
   - Instance type: **Free** (do *not* add a paid disk — the whole point of this path is not needing one)
   - Environment variables: `SECRET_KEY` (generate one, see the table above), `MONGODB_URI`, `CLOUDINARY_URL` (from steps 3–4), `NODE_ENV=production`
3. **Database — [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)**, free M0 cluster:
   - Create a free M0 cluster (any provider/region)
   - Database Access → add a database user with a password
   - Network Access → add `0.0.0.0/0` (Render's free tier has no fixed IP to allowlist more narrowly)
   - Connect → Drivers → copy the connection string, put your DB user's username/password into it → this is `MONGODB_URI`
4. **File storage — [Cloudinary](https://cloudinary.com/users/register/free)**, free tier:
   - Dashboard → copy the **API Environment variable** value, shown as `CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud_name>` → the part after the `=` is what you set as `CLOUDINARY_URL` on Render
5. **Domain**: in Hostinger's DNS zone editor for your domain, point it at Render (Render's dashboard shows the exact CNAME/A record to add once the service exists; Render also issues the free SSL certificate automatically once the DNS record resolves).

Cost: **$0/month.** Tradeoffs versus a VPS or Hostinger's paid Node hosting: Render's free tier spins
the service down after ~15 minutes of no traffic (the next visitor waits a few seconds for it to wake
up), and Atlas's free M0 tier doesn't include automated backups — use the dashboard's **Backup** page
to download a JSON snapshot periodically.

## Project layout

```
server.js            entry point — security headers, static files, mounts routes/, public site
lib/                  store.js (JSON db), auth.js, crypto.js, gemini.js, mailer.js, theme.js, render.js, util.js
routes/               auth.js, content.js, media.js, blog.js, ai.js, contact.js, public.js
admin/                the dashboard SPA (index.html, app.js, admin.css) + editor.js (live-page preview banner)
public/               css/js/images/docs served as-is; theme.css and site-config.js are generated per-request
templates-src/        the ORIGINAL static HTML (source of truth for layout/design)
templates/            generated from templates-src/ by scripts/annotate.js — do not hand-edit
scripts/annotate.js   re-run this after changing templates-src/*.html, then restart the server
scripts/smoketest.js  end-to-end test suite — see below
```

### Changing the page design/layout

Edit `templates-src/*.html` (or `public/css/style.css`), then:

```bash
node scripts/annotate.js
```

This regenerates `templates/*.html` and `templates/defaults.json`. **Key stability caveat:** each
editable item gets an auto-numbered key (`index.14`, `g.h.2`, …) based on its position in the page.
Adding/removing/reordering elements in `templates-src` shifts the numbering for everything after that
point. Any content an admin already edited through the dashboard is stored by that key — if the
numbering shifts, an edit can silently end up attached to the wrong element (or just vanish if the
key disappears). For small wording tweaks in `templates-src` this is harmless; for structural changes,
check `git diff templates/defaults.json` after re-running the script, and expect that admins may need
to re-apply a few content edits.

### Running the test suite

```bash
DATA_DIR=/some/empty/temp/dir PORT=4173 node server.js &
# copy the setup code it prints, then:
BASE_URL=http://127.0.0.1:4173 SETUP_TOKEN=<code> node scripts/smoketest.js
```

92 checks covering auth/CSRF/roles, content editing reaching the live page, media upload validation,
blog/page publishing and nav sync, theme, contact-form + honeypot/rate-limiting, SMTP settings, AI
settings and the chatbot's fallback behaviour, and account-safety edge cases. It always runs against a
disposable `DATA_DIR` — never point it at a real site's data.

To check the MongoDB/Cloudinary code paths without a real account, `scripts/test-mongo-store.js`
verifies `lib/store.js`'s Mongo logic against a stub that mimics the real driver, and
`scripts/fake-cloudinary-preload.js` (used via `NODE_OPTIONS="--require ..."`) lets the real HTTP
server run with uploads faked instead of hitting Cloudinary — both are what actually caught bugs
while building the free-tier deployment, not just theoretical coverage:

```bash
node scripts/test-mongo-store.js

CLOUDINARY_URL="cloudinary://fake:fake@fake" NODE_OPTIONS="--require ./scripts/fake-cloudinary-preload.js" \
  DATA_DIR=/some/empty/temp/dir PORT=4175 node server.js
```

### Resetting a forgotten password

There's no "forgot password" email flow yet. With server access, stop the server and edit
`data/db.json`'s `users` array directly (or write a one-off Node script using `lib/auth.js`'s
`hashPassword()`), or delete the file entirely to start over (this deletes **all** content, so back
it up first).
