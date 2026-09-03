# Atlas Desk 2.4

Market-structure command center for Jaleel Rhodes.

This is a **structure desk**, not a broker. It never places trades.

## Live

https://atlas-desk-gamma.vercel.app

## 2.4 surfaces

- Screenshot drop box (local only — drop / paste / pick)
- Entry · TP · SL signal board with R:R and hard-block checks
- Add to Home Screen (PWA + iOS Safari instructions)

## Live contract

`GET /api/health` must return `ok: true`, `version: atlas-2.4.0`, `watch: 24/7`.

## Memory Cloud plugin

Mem0 stays behind an operator gate. The public page does not hold secrets.

1. Create an API key at [app.mem0.ai](https://app.mem0.ai).
2. On the Vercel project, set as **Secrets**:
   - `MEM0_API_KEY`
   - `ATLAS_MEMORY_GATE` (long random operator key)
   - `MEM0_USER_ID` (optional; defaults to `atlas-desk-jaleel`)
3. Redeploy.
4. Public `GET /api/memory` returns only `{ gated: true }` — no user id, no connected flag.
5. Operator `GET` / `POST` must send header `x-atlas-memory-key: $ATLAS_MEMORY_GATE`.
6. Write cap is 2000 characters. Upstream errors are not echoed.

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
