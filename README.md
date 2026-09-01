# Atlas Desk 2.3

Market-structure command center for Jaleel Rhodes.

This is a **structure desk**, not a broker. It never places trades.

## Live contract

`GET /api/health` must return `ok: true`, `version: atlas-2.3.0`, `watch: 24/7`.

## Memory Cloud plugin

Atlas Desk now ships a Mem0 cloud memory plugin.

1. Create an API key at [app.mem0.ai](https://app.mem0.ai).
2. On the Vercel project, set:
   - `MEM0_API_KEY`
   - `MEM0_USER_ID` (optional; defaults to `atlas-desk-jaleel`)
3. Check `GET /api/memory` — `plugin.connected` should be `true`.
4. Write a note: `POST /api/memory` `{ "action": "write", "text": "..." }`
5. Recall: `POST /api/memory` `{ "action": "recall", "query": "..." }`

The plugin cannot place trades and does not change hard blocks.

## Hard blocks

- No gold sells at demand
- No JPY dumps without CHoCH
- 2.00 lot cap
- No averaging
- No chasing a just-hit TP

## Surfaces

- GitHub: `jaleelrhodes99-lab/atlas-desk`
- Vercel team: `jaleelrhodes99-4870`
- Plugin manifest: `plugins/memory-cloud.json`
