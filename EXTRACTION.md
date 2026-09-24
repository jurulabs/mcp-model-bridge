# Moving this package into its own repository

The package is already self-contained: it inherits nothing from the surrounding monorepo, its tests run against their own fixture project, and its build needs no parent `tsconfig.json`. What follows is how to give it a repository of its own without losing history.

## Why bother

While it lives under `packages/`, the bridge is a tool that happens to sit inside a Shopify app. It is not a dependency of that app. Two consequences:

- Installing it in a second project means copying a directory, and copies drift.
- Its version is entangled with a release cycle it has nothing to do with.

Its own repository fixes both. The cost is one more repository to maintain, which is only worth paying once you use the bridge in more than one project.

## Step 1 — Split out the history

From the monorepo root:

```powershell
git subtree split --prefix=packages/mcp-model-bridge -b bridge-standalone
```

This replays every commit that touched the package onto a new branch, with the package directory as the repository root. Verify before continuing:

```powershell
git --no-pager log --oneline bridge-standalone
git --no-pager ls-tree --name-only bridge-standalone
```

The tree listing must show `package.json` and `src` at the top level. If it shows `packages/`, the prefix was wrong.

## Step 2 — Clone the branch into a new repository

```powershell
git clone . ..\mcp-model-bridge --branch bridge-standalone --single-branch
cd ..\mcp-model-bridge
git branch -m bridge-standalone main
git remote remove origin
```

The clone source is `.` — the monorepo itself. Removing `origin` prevents an accidental push back into it.

## Step 3 — Prove it stands alone

```powershell
npm install
npm test
npm run smoke
```

All three must pass with no reference to the monorepo. The smoke test uses `test/fixture-workspace`, which travelled with the split.

## Step 4 — Point it at a real remote

```powershell
git remote add origin https://github.com/<you>/mcp-model-bridge.git
git push -u origin main
```

## Step 5 — Install it where you need it

```powershell
npm install -g git+https://github.com/<you>/mcp-model-bridge.git
```

Then register it once per project in *Settings → Tools → GitHub Copilot → Model Context Protocol (MCP)*, with `BRIDGE_WORKSPACE_ROOT` pointing at that project. See [README.md](./README.md).

## Step 6 — Remove the copy from the monorepo

Only after steps 3 to 5 have been verified. Two copies of the same package is the failure mode this exercise exists to prevent.

```powershell
cd ..\jurulabs-shopify
git rm -r packages/mcp-model-bridge
```

Then drop the convenience scripts from the root `package.json`:

```json
"bridge:build": "npm run build --workspace=packages/mcp-model-bridge",
"bridge:smoke": "npm run smoke --workspace=packages/mcp-model-bridge",
```

And refresh the lockfile:

```powershell
npm install
```

## Loose ends to settle in the new repository

- **`LICENSE` file.** `package.json` declares MIT but no licence text ships with the package. Add one naming the copyright holder.
- **npm scope.** Publishing as `@jurulabs/mcp-model-bridge` requires owning that scope on the target registry. Git installs need no registry at all, so this is only a question if you decide to publish.
- **CI.** A workflow running `npm test` and `npm run smoke` is worth adding, since the smoke test is what catches host-project regressions.

