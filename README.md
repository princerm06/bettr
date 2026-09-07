# Himothy MVP

Private self-improvement dashboard for close friends.

## Current prototype

- 10 life categories
- Two-tap quick logging
- Custom entries with notes and optional photos
- Local prototype "AI insight" on custom entries
- Priority-aware Discipline score
- Progress bars and recent-memory cards
- 5-week activity heatmap + detailed history
- Friend accountability feed with reactions
- Responsive/mobile navigation
- Browser localStorage persistence

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Important prototype limitation

Photos are currently compressed and stored in browser localStorage. This is intentionally only for the local MVP and will hit browser storage limits if you add many images. The production pass should move users, logs, images, priorities, friendships, reactions, and analysis results to a database/object-storage backend.

The current AI insight is explicitly a local prototype heuristic. A real multimodal model can later analyze the text + uploaded image through a protected server endpoint once authentication/backend storage is added. Never put an AI provider secret key directly in browser code.
