# Scaling Plan — Pool League → Commercial Multi-Tenant SaaS

> Created: March 2026  
> Context: Analysis of what it would take to evolve the current Pool League app into a full-scale commercial application where users can register, create leagues, and invite friends.

---

## Current State

The app is a single Node/Express process with:
- Data stored in **append-only JSONL files** on disk (one directory per league: `players.jsonl`, `games.jsonl`, monthly `snapshots/`)
- **No authentication** — anyone on the network can read and write everything
- **No concept of user accounts** — players are just free-text names inside a league file
- No league ownership — anyone can create or modify any league
- League switching via `localStorage`
- Per-league **in-memory cache** — state is derived by replaying the game log on first access, then kept warm; updated in-place on writes

Core business logic (ELO calculation, badge computation, King of the Hill, records, Defend the Hill) is pure JavaScript functions that don't touch storage and can be reused largely unchanged.

> **Note:** The storage model was upgraded from mutable JSON files to an append-only event log in March 2026. This changes the urgency and recommended path for database migration — see the updated section below.

---

## 1. Data Storage — How the Append-Only Model Changes the Plan

### What changed and why it matters

The original plan assumed mutable JSON files and treated "migrate to Postgres immediately" as urgent. That urgency was driven by two problems:

- **Concurrent write safety** — `getDb()`/`saveDb()` read-modify-wrote the entire file, creating a race condition under simultaneous requests
- **Stale derived state** — ratings were stored in the file and could drift out of sync

Both of these are now solved:
- Every write is a single `appendFileSync` call — atomic at the OS level
- Ratings are never stored; they are always derived by replaying the game log

The current storage model is effectively **event sourcing with snapshots** — the same pattern used by production systems like Kafka and EventStoreDB. This changes the recommended migration path.

---

### Revised Path Forward

```
Current (JSONL files, already safe)
    ↓  same data shape, swap storage layer
SQLite event log  ←  good for private / club use indefinitely
    ↓  when you need multi-tenant / public cloud
Postgres event log (Supabase)  ←  full SaaS
```

Each step preserves all business logic. Only the storage layer changes.

---

### Path A — Stay on JSONL, add a small auth database (lightest)

Keep the JSONL game/player logs exactly as-is. Add a minimal relational store (SQLite or Postgres) only for user accounts and league membership:

```sql
users         (id, email, password_hash, display_name, created_at)
league_members(league_slug, user_id, role, joined_at)
invitations   (token, league_slug, invited_email, status, expires_at)
```

Auth guards the write routes. The JSONL files remain the source of truth for game history and ratings.

**Best for:** A private/family app — minimal code change, zero infrastructure cost.

**Limitation:** Two storage systems; can't easily query across leagues.

---

### Path B — SQLite event log (recommended intermediate step)

Replace JSONL files with a SQLite database using the same append-only discipline — `INSERT` only, no `UPDATE` or `DELETE` on game rows. This is a near 1:1 migration:

```sql
-- replaces players.jsonl
CREATE TABLE player_registrations (
  id            TEXT PRIMARY KEY,
  league_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  registered_at TEXT NOT NULL
);

-- replaces games.jsonl
CREATE TABLE game_events (
  id                   TEXT PRIMARY KEY,
  league_id            TEXT NOT NULL,
  winner_id            TEXT NOT NULL,
  loser_id             TEXT NOT NULL,
  winner_rating_before INTEGER NOT NULL,
  loser_rating_before  INTEGER NOT NULL,
  winner_rating_after  INTEGER NOT NULL,
  loser_rating_after   INTEGER NOT NULL,
  rating_change        INTEGER NOT NULL,
  played_at            TEXT NOT NULL
);

-- replaces snapshots/*.json
CREATE TABLE rating_snapshots (
  league_id    TEXT NOT NULL,
  player_id    TEXT NOT NULL,
  rating       INTEGER NOT NULL,
  wins         INTEGER NOT NULL,
  losses       INTEGER NOT NULL,
  snapshot_at  TEXT NOT NULL,
  PRIMARY KEY (league_id, player_id, snapshot_at)
);
```

**Pros:**
- Zero infrastructure (SQLite = one file)
- Proper SQL querying — cross-league stats, GROUP BY, JOIN
- Concurrent reads are fast; WAL mode handles concurrent writes safely
- Moving from JSONL is straightforward — same data shape, same event-sourcing discipline
- `better-sqlite3` npm package is synchronous and fits the existing Express code with minimal refactoring

**Best for:** Small club / up to ~50 active users, or as a stepping stone before Postgres.

---

### Path C — Postgres with event-sourcing discipline (full SaaS)

The full relational model described in the original plan, but preserving the append-only pattern:

```sql
-- New tables vs original plan
users           (id, email, password_hash, display_name, created_at)
leagues         (id, name, slug, game_type, created_by, created_at)
league_members  (id, league_id, user_id, role, elo_rating, wins, losses, joined_at)

-- Keep game_events INSERT-only — never UPDATE/DELETE a result
game_events     (id, league_id, winner_id, loser_id,
                 winner_rating_before, loser_rating_before,
                 winner_rating_after, loser_rating_after,
                 rating_change, played_at, recorded_by)

-- Soft-delete tombstones instead of hard DELETE
game_deletions  (game_id, deleted_by, deleted_at, reason)

-- Periodic snapshots cached in DB instead of JSON files
rating_snapshots(league_id, player_id, rating, wins, losses, snapshot_at)

-- Invitations
invitations     (id, league_id, invited_email, invited_by, token, status, expires_at)
```

**Key insight:** The `elo_rating`, `wins`, `losses` columns on `league_members` are still derived state — they can be updated by app code after each game or regenerated from the event log at any time. The event log is always the source of truth.

**Recommended database:** [Supabase](https://supabase.com) (PostgreSQL + Auth + Storage in one free-tier service)

**Recommended ORM:** [Prisma](https://www.prisma.io/) or [Drizzle](https://orm.drizzle.team/)

---

### What Carries Over Unchanged (all paths)

The following pure-JS functions have no storage dependency and move over untouched regardless of which path is chosen:

- ✅ `calcElo()` — ELO rating calculation
- ✅ `replayGames()` — derives ratings from an event list
- ✅ `computeBadges()` — all badge logic
- ✅ `computeKingOfTheHill()` — king tracking
- ✅ All records computation (win streaks, defend the hill, biggest upset, etc.)
- ✅ The general API route shape (`/api/leagues`, `/api/players`, `/api/games`, `/api/records`)

### What Gets Replaced (Path C / Postgres)

| Current | Replacement |
|---|---|
| `appendJsonl()` / `readJsonl()` | Prisma / Drizzle `INSERT` / `SELECT` |
| `coldLoad()` + `getCache()` | DB query + in-memory cache (same pattern) |
| `loadLatestSnapshot()` / `writeSnapshot()` | Query `rating_snapshots` table |
| `getLeagues()` | DB query filtered by `league_members.user_id` |
| Player IDs as `Date.now()_random` strings | UUIDs from the database |
| `localStorage` for league switching | Server-side session / URL routing |

### Options

| Option | Complexity | Notes |
|---|---|---|
| DIY with `bcrypt` + `express-session` | High | Must also build: email verification, password reset, CSRF protection, rate limiting |
| **Passport.js** | Medium | Handles local + OAuth strategies, still requires session management |
| **Supabase Auth** | Low | Built-in if using Supabase for DB. Handles everything. |
| **[Clerk](https://clerk.com/)** | Low | Best developer experience; pre-built React UI components |
| **Auth0** | Low | More enterprise-focused, more expensive at scale |

**Recommendation: Supabase Auth** (if using Supabase DB) or **Clerk** (if you want the best pre-built UI components for React/Next.js).

Both offload:
- Password hashing and storage
- Email verification flows
- Password reset emails
- OAuth providers (Google, Apple, GitHub, etc.)
- MFA
- JWT session tokens
- Security patches

### Auth Middleware Pattern

```js
// middleware/auth.js
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = await verifyJWT(token); // from your auth provider
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// middleware/leagueAccess.js
async function requireLeagueMember(req, res, next) {
  const member = await db.leagueMembers.findOne({
    leagueId: req.params.leagueId,
    userId: req.user.id
  });
  if (!member) return res.status(403).json({ error: 'Not a member of this league' });
  req.member = member;
  next();
}

// middleware/leagueAdmin.js
async function requireLeagueAdmin(req, res, next) {
  await requireLeagueMember(req, res, () => {
    if (!['owner', 'admin'].includes(req.member.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}
```

### Protected Routes Pattern

```js
// Anyone authenticated + in the league can view
app.get('/api/leagues/:id/players', requireAuth, requireLeagueMember, getPlayers);

// Only admins can record or delete games
app.post('/api/leagues/:id/games',        requireAuth, requireLeagueAdmin, recordGame);
app.delete('/api/leagues/:id/games/:gid', requireAuth, requireLeagueAdmin, deleteGame);
```

---

## 3. League Membership & Invitations

### User Journey

```
1. User registers → gets an account
2. User creates a league → becomes its "owner"
3. Owner invites someone by email → invitation row created, email sent
4. Invitee clicks link in email:
     → If they have an account: added as a member immediately
     → If not: taken to registration page, then added on completion
5. Member can view the league and record games they played in
6. Admin/Owner can record any game, delete games, manage members
```

### Invitation Implementation (sketch)

```js
// POST /api/leagues/:id/invitations
async function inviteToLeague(req, res) {
  const { email } = req.body;
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.invitations.create({
    leagueId: req.params.id,
    invitedEmail: email,
    invitedBy: req.user.id,
    token,
    expiresAt: expires,
    status: 'pending'
  });

  await sendEmail({
    to: email,
    subject: `You've been invited to join ${league.name}`,
    body: `Click here to join: https://yourapp.com/join?token=${token}`
  });

  res.json({ message: 'Invitation sent' });
}

// GET /api/invitations/:token/accept
async function acceptInvitation(req, res) {
  const invite = await db.invitations.findOne({ token: req.params.token });

  if (!invite || invite.status !== 'pending' || invite.expiresAt < new Date()) {
    return res.status(400).json({ error: 'Invitation is invalid or expired' });
  }

  if (req.user.email !== invite.invitedEmail) {
    return res.redirect(`/register?invite=${req.params.token}`);
  }

  await db.leagueMembers.create({
    leagueId: invite.leagueId,
    userId: req.user.id,
    role: 'member',
    eloRating: 1000,
    wins: 0,
    losses: 0
  });

  await db.invitations.update({ token: req.params.token }, { status: 'accepted' });
  res.redirect(`/league/${invite.leagueId}`);
}
```

### Email Sending

| Service | Notes |
|---|---|
| **[Resend](https://resend.com/)** | Best developer experience in 2026, 3,000 emails/month free |
| **SendGrid** | More established, more complex |
| **AWS SES** | Cheapest at scale, more infrastructure work |

**Recommendation: Resend**

---

## 4. Frontend

The current frontend is vanilla HTML + JS files served statically. This works but becomes hard to manage as auth state, user sessions, league switching, and real-time updates are added.

### Framework Options

| Framework | Notes |
|---|---|
| **Next.js** (React) | Most ecosystem; great for SEO via SSR; Clerk/Auth0 have first-class Next.js support |
| **SvelteKit** | Smaller bundle, great DX, full-stack in one framework, simpler than React |
| **React + Vite** | SPA only — no SSR without extra config |

**Recommendation: SvelteKit or Next.js**

If using Clerk for auth, it provides pre-built `<SignIn />`, `<SignUp />`, and `<UserButton />` React components — you don't write login forms at all.

---

## 5. Infrastructure & Deployment

| Layer | Current | Production Target |
|---|---|---|
| **Server** | `node index.js` on localhost | Containerised (Docker) on a cloud platform |
| **Database** | JSON files on disk | PostgreSQL on Supabase / Railway / Render |
| **File storage** | N/A | S3 or Supabase Storage (avatars, etc.) |
| **Email** | None | Resend / SendGrid |
| **Hosting** | localhost | Render / Railway / Fly.io / Vercel |
| **Domain** | None | Custom domain via Cloudflare |
| **HTTPS** | None | Automatic via hosting platform |
| **Secrets** | None | Environment variables via hosting dashboard |

### Recommended Free-Tier Stack

| Service | Purpose | Cost |
|---|---|---|
| **Supabase** | PostgreSQL + Auth + Storage | Free tier |
| **Render** | Node server hosting, auto-deploys from GitHub | Free tier |
| **Resend** | Transactional email | Free (3k/month) |
| **Cloudflare** | Domain + DDoS protection | Free |

**Estimated monthly cost at small scale: £0** (all free tiers)

---

## 6. What Carries Over From the Current App

More than you might think. The following are pure JS functions with no file I/O — they move over almost unchanged:

- ✅ `calcElo()` — ELO rating calculation
- ✅ `computeBadges()` — all badge logic
- ✅ `computeKingOfTheHill()` — king tracking
- ✅ All records computation (win streaks, defend the hill, biggest upset, etc.)
- ✅ The general API route shape (`/api/leagues`, `/api/players`, `/api/games`, `/api/records`)

### What Gets Replaced

| Current | Replacement |
|---|---|
| `appendJsonl()` / `readJsonl()` | Prisma / Drizzle `INSERT` / `SELECT` |
| `coldLoad()` + `getCache()` | DB query + in-memory cache (same pattern) |
| `getLeagues()` | DB query filtered by `created_by` or `league_members.user_id` |
| Player IDs as random strings | UUIDs from the database |
| Flat `players` array inside a league file | `league_members` join table |
| `localStorage` for league switching | Server-side session / URL routing |

---

## 7. Phased Migration Plan

Rather than a big-bang rewrite, work in phases:

| Phase | Work | Result |
|---|---|---|
| **1a. Add auth (JSONL stays)** | Integrate Supabase Auth or Clerk. Add login/register pages. Add a small `users` + `league_members` SQLite/Postgres table. Protect write routes with a token check. | Users can log in; writes require auth; JSONL files unchanged |
| **1b. Move to SQLite event log** | Replace JSONL files with a SQLite database using `better-sqlite3`. Keep `INSERT`-only discipline — same data shape, same event-sourcing pattern. | One storage system, full SQL querying, zero infrastructure cost |
| **2. Move to Postgres** | Set up Supabase. Port data from SQLite → Postgres. Add `leagues` + `league_members` tables. | Durable cloud database, concurrent-safe, queryable |
| **3. Add ownership** | Leagues have an `owner_id`; add `league_members` table; only members see a league | True multi-tenancy |
| **4. Add invitations** | Build invite flow + email sending via Resend | Users can invite friends |
| **5. Modernise frontend** | Migrate to SvelteKit or Next.js | Better routing, auth state, potentially real-time |
| **6. Deploy** | Render + Supabase + custom domain | Publicly accessible |

Phases 1a and 1b are largely independent and can be done in either order. Together they result in a secure, properly-stored app with minimal infrastructure cost — a good stopping point before committing to the full Postgres/SaaS path.


- [ ] Auth provider choice: **Supabase Auth** vs **Clerk**?
- [ ] ORM choice: **Prisma** vs **Drizzle**?
- [ ] Frontend framework: **Next.js** vs **SvelteKit** vs stay with vanilla JS?
- [ ] Should ELO ratings be **per-league** (current behaviour) or **global across leagues for the same game type**?
- [ ] Should leagues be **public** (discoverable) or **private** (invite-only) by default?
- [ ] What happens to the **King of the Hill** when a new member joins mid-league?
- [ ] Should game recording require **both players to confirm** the result, or trust the person recording it?

