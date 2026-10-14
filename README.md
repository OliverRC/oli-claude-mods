# Oli's Claude Code mods

A marketplace of Claude Code mods, one per folder under `plugins/`.

| Mod | What it does |
| --- | --- |
| [Clean View](plugins/clean-view) | A calm checklist above the prompt that hides tool calls, diffs and command output while Claude works. Idea by [Tristen O'Brien](https://tristenobrien.ai/). |

## Naming

Each mod is named `oli-claude-mod-<what-it-does>` and lives in `plugins/<what-it-does>/`. Plugin
names may not start with `claude-` (Claude Code reserves those for Anthropic), so the `oli-` prefix
comes first. The marketplace itself is `oli-claude-mods`.

## Install

At the Claude Code prompt:

```
/plugin marketplace add OliverRC/oli-claude-mods
/plugin install oli-claude-mod-clean-view@oli-claude-mods
```

On this machine, read straight from this folder so edits apply after `/reload-plugins`:

```
claude plugin marketplace add ~/Dev/GitHub/oliverrc/oli-claude-mods
claude plugin install oli-claude-mod-clean-view@oli-claude-mods --scope user
```

## Add a mod

Create `plugins/<name>/` with its own `.claude-plugin/plugin.json` (named `oli-claude-mod-<name>`),
then add it to the `plugins` list in `.claude-plugin/marketplace.json`.
