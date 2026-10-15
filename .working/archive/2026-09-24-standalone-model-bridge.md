# Implementation Plan: MCP Model Bridge als eigenständiges Paket
**Date:** 2026-09-24
**Status:** DONE

## Goal

`mcp-model-bridge` soll projektunabhängig sein: installierbar und ausführbar in
**jedem** Repository, ohne das Monorepo `jurulabs-shopify` vorauszusetzen.

## Ausgangslage — wo die Kopplung sass

Die Laufzeit war bereits weitgehend entkoppelt (Workspace-Root, Agents-Verzeichnis
und Policy-Pfad waren Umgebungsvariablen). Die Blocker lagen in der **Verpackung**:

| # | Kopplung | Datei | Behoben durch |
|---|---|---|---|
| 1 | `extends: "../../tsconfig.json"` | `tsconfig.json` | Optionen inline aufgelöst |
| 2 | `private: true` | `package.json` | entfernt, `files`/`prepack` ergänzt |
| 3 | fehlender Shebang | `src/index.ts` | `#!/usr/bin/env node`, im Artefakt verifiziert |
| 4 | kein `files`-Feld | `package.json` | Tarball auf 35 Dateien / 18 KB begrenzt |
| 5 | `resolve(packageRoot, '../..')` | `scripts/smoke-test.mjs` | eigener Fixture-Workspace |
| 6 | Policy nur aus Paketwurzel | `src/index.ts` | `policy-locator.ts` mit 3-stufiger Suche |
| 7 | harte Pfade `jurulabs-shopify` | `README.md` | neu geschrieben |

## Ergebnis

- **Eigenständiges Repository:** `C:\Users\z003wbfu\WebstormProjects\mcp-model-bridge`,
  5 Commits Historie via `git subtree split`, `origin` entfernt.
- **Fremdprojekt-Nachweis:** Tarball in ein TEMP-Projekt installiert, dort Agent
  und Policy des Fremdprojekts korrekt entdeckt und ausgeführt.
- **Kreuzprojekt-Nachweis:** eigenständiger Build gegen das Monorepo als Host
  ausgeführt, `Explorer` geladen, Modell `gpt-5.6-luna` gemeldet.

## Unterwegs gefundene Fehler

| Fehler | Fundort | Wirkung |
|---|---|---|
| UTF-8 BOM bricht `JSON.parse` | Policy-Datei | Server startete nicht, Meldung zeigte woanders hin |
| UTF-8 BOM bricht Frontmatter-Regex | `.agent.md` | Agent galt als ungültig |
| `main` zeigte auf das Bin-Modul | `package.json` | Import hätte sofort einen Stdio-Server geöffnet |
| `list_agents` listete keine Agents | `src/index.ts` | Beschreibung widersprach dem Verhalten |
| Tests vom Typecheck ausgeschlossen | `tsconfig.json` | Testcode nie typgeprüft |

Der BOM-Fund stammt aus dem Fremdprojekt-Test: PowerShell schrieb die Policy mit
BOM. Ohne diesen Test wäre der Fehler erst beim ersten Windows-Nutzer aufgetreten.

## Verifikation

| Prüfung | Ergebnis |
|---|---|
| Unit-Tests | 81 in 9 Dateien |
| Typecheck (inkl. Tests) | 0 Fehler |
| Smoke-Test | 12/12 gegen Fixture-Projekt |
| Eigenständiges Repo: install/test/smoke | alle grün, ohne Monorepo |
| Fremdprojekt-Installation | bestanden |

## Offene Punkte

- `LICENSE` nennt `JuRuLabs` als Rechteinhaber — bei Bedarf korrigieren.
- Veröffentlichen unter `@jurulabs` setzt Besitz des Scopes voraus. Git-Installation
  und `npm link` brauchen keine Registry.
- Die Kopie unter `packages/mcp-model-bridge` bleibt vorerst bestehen. Entfernen
  erst nach produktiver Nutzung des eigenständigen Repos — siehe `EXTRACTION.md`
  Schritt 6. Zwei Kopien sind genau das Risiko, das diese Arbeit vermeiden soll.

