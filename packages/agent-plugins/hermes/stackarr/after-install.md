# Stackarr plugin installed

Stackarr installed the Hermes plugin and wrote `stackarr-command.json` so the plugin talks to this Stackarr install via:

```bash
stackarr mcp serve
```

If Hermes was available during install, Stackarr attempted to enable the plugin automatically. If not, run:

```bash
hermes plugins enable stackarr
```

Then restart Hermes or `/reset` so the `stackarr` toolset is loaded.
