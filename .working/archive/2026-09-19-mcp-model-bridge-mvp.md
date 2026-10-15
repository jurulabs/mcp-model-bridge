# Implementation Plan: MCP Model Bridge MVP
**Date:** 2026-09-19
**Status:** DONE

## Goal

Ein lauffähiger MCP-Server, der eine Agent-Definition aus `.github/agents/` lädt, sie als System-Prompt gegen ein **benanntes** Modell ausführt und das Ergebnis zurückgibt. Abnahmekriterium aus der Architektur: Der Server meldet das tatsächlich verwendete Modell — meldet er das Session-Modell, ist er gescheitert.

MVP-Umfang entspricht der Stufe **bounded agent**: zwei Werkzeuge (`read_file`, `grep_search`), harte Rundenbegrenzung, Pfad-Einschränkung auf den Workspace.

## Affected Areas
- [x] Neues Workspace-Paket `packages/mcp-model-bridge`
- [x] Workspace-Root `package.json` (Skript-Eintrag)
- [ ] Bestehende App-Pakete — unberührt

## Files
| File | Action | Description |
|---|---|---|
| `packages/mcp-model-bridge/package.json` | NEW | Paketdefinition, MCP-SDK, Zod |
| `packages/mcp-model-bridge/tsconfig.json` | NEW | strict, ESM |
| `packages/mcp-model-bridge/README.md` | NEW | Start, Konfiguration, MCP-Registrierung |
| `src/types.ts` | NEW | Cross-Modul-Typen |
| `src/agent-loader.ts` | NEW | Frontmatter + Rumpf aus `.agent.md` parsen |
| `src/model-resolver.ts` | NEW | Tier-Namen gegen Allow-List auflösen |
| `src/workspace-tools.ts` | NEW | `read_file`, `grep_search`, Pfad-Confinement |
| `src/gateway-client.ts` | NEW | Completion-Aufruf, Mock-Modus ohne Zugangsdaten |
| `src/agent-loop.ts` | NEW | Begrenzte Schleife, Tool-Dispatch |
| `src/index.ts` | NEW | MCP-Server, stdio, Werkzeug `run_agent` |
| `src/*.test.ts` | NEW | Unit-Tests je Modul |

## Open Questions / Risks
- Zugangsdaten für das Gateway liegen nicht vor → Mock-Modus als Standard, damit die Verdrahtung ohne Secrets testbar ist.
- Genaues API-Schema des Gateways unbestätigt → Client kapselt das Schema hinter einem Interface, Austausch ist eine Einzeldatei.
- Agent-Rümpfe setzen reichere Werkzeuge voraus (`semantic_search`); der MVP bietet nur zwei. Betroffene Agents degradieren, statt zu scheitern.

## Implementation Steps
1. Paketgerüst mit strict TypeScript und ESM.
2. `agent-loader` + Tests — Frontmatter und Rumpf trennen.
3. `model-resolver` + Tests — Tier auflösen, unbekanntes Modell hart ablehnen.
4. `workspace-tools` + Tests — Pfad-Confinement ist sicherheitsrelevant.
5. `gateway-client` mit Mock-Modus + Tests.
6. `agent-loop` + Tests — Rundenbegrenzung, Tool-Dispatch.
7. MCP-Server verdrahten, Smoke-Test über stdio.
8. Registrierungsanleitung in README.

## Result

Abnahmekriterium erfüllt: Derselbe `Explorer` meldet auf Tier `cheap` das Modell
`gpt-5.6-luna` und auf Tier `strong` das Modell `claude-opus-5`. Der System-Prompt
stammt mit 1223 Zeichen aus `.github/agents/Explorer.agent.md`, die Werkzeugschleife
lief mit einem Tool-Call in zwei Runden.

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` (alle Pakete) | 0 Fehler |
| Unit-Tests Brücke | 48 in 5 Dateien |
| Unit-Tests Workspace gesamt | 55 Dateien, alle grün |
| `npm run bridge:smoke` | PASSED, 9 Prüfpunkte |

Offen: Gateway läuft im Mock-Modus. Für echte Aufrufe `BRIDGE_GATEWAY_URL` und
`BRIDGE_GATEWAY_TOKEN` setzen; das Schema ist in `gateway-client.ts` gekapselt.


