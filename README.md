# IEM Photography Competition — New Website

This is a new website built from the requirements discussed for the IEM/UEM photography competition. It is intentionally separate from the previous Bolt-hosted site.

## What is included

### Instant demo (zero setup)
Open `instant-demo/index.html` in Chrome/Edge. It is a complete presentation-ready interactive prototype using browser storage:
- cinematic IEM landing page with floating 3D-style photo cards
- student portal and registration/login
- gallery, search and category filters
- photo viewer and one-vote-per-student-per-photo protection
- My Entries page
- separate organizer login/console
- organizer dashboard and live/closed voting switch
- organizer submission upload directly from the browser
- category management
- live leaderboard/results
- demo credentials included on login screens

Demo organizer: `organizer@iem.local` / `ChangeMe123!`
Demo student: `student@iem.local` / `ChangeMe123!`

The demo stores changes in browser localStorage. It is excellent for presentation/testing but should not be used as the final multi-user production server.

## Full-stack version

`frontend/` = React/Vite website.
`backend/` = Express + SQLite API with JWT auth, organizer/student roles, image uploads, categories, voting and results.

Run backend:
1. `cd backend`
2. `npm install`
3. copy `.env.example` to `.env`
4. `npm run dev`

Run frontend in another terminal:
1. `cd frontend`
2. `npm install`
3. copy `.env.example` to `.env`
4. `npm run dev`

The API automatically creates the SQLite database and demo records on first startup.

## Production scaling

For a real competition with many concurrent users, replace SQLite/local uploads with PostgreSQL + S3/Supabase Storage/CDN and deploy the API behind a load balancer. The current architecture already separates frontend, API, authentication, voting and organizer operations so that migration is straightforward.

## ENV file note

The earlier phrase “ENV file” was ambiguous. This project supports organizer bulk-import JSON in the full-stack API. If the actual submission file is a specific `.env`, CSV, Excel, ZIP or other format, provide one sample and the importer can be mapped exactly to that format.

## OpenAI API

No OpenAI API key or OpenAI billing is required for the core website. The competition platform works without AI services.

## Competition workflow (updated)

- Organizers, not students, publish photographs to the public gallery.
- Organizers choose the category and the eligible student/creator when posting a photograph.
- Students create accounts only to participate in voting; they do not upload photographs through the public portal.
- Each student can vote once per photograph. Duplicate votes are rejected by a database uniqueness constraint and server-side handling.
- Voting is accepted only while the active competition is `live` and within its configured start/end window.
- Public results remain hidden while voting is live.
- When the organizer closes voting, the system calculates the final overall top 3 and category winners from the vote totals.
- The organizer console has a final-tally view and the public Results page becomes available after closing.
