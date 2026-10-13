# Clean View

A Claude Code mod that makes Claude feel calm for non-technical people: tool calls, diffs and
command output are hidden, and a simple checklist above the prompt shows the plan, the current
step and how far along it is.

## Use it

- Click **● Clean View: ON** at the right of the band above the prompt to switch it, or type
  `/simple on`, `/simple off`, or `/simple` to flip it. The choice is remembered.

## Install

On this machine (read straight from this folder, so edits apply after `/reload-plugins`):

```
claude plugin marketplace add ~/Dev/GitHub/clean-view
claude plugin install clean-view@clean-view-local --scope user
```

From GitHub, once this folder is pushed to a repository, at the Claude Code prompt:

```
/plugin install clean-view --marketplace <owner>/<repo>
```

Then press `y` to add the marketplace and pick the user scope.

## Develop

```
claude plugin validate .
claude plugin test .
```
