# Bid Workshop

Bid Workshop is a desktop application for AI-powered bid/tender document review. It uses pi-gui as its Electron shell and genoffice document engine for rendering and editing Word documents.

## Architecture

- **Shell**: Electron desktop app (forked from pi-gui)
- **Document engine**: genoffice core packages (docx-engine, file-parse, html2docx, font-metrics, i18n)
- **Extensions**: Bid review logic implemented as Pi desktop extensions
- **Skills**: Custom Pi skills for bid review workflows

## Structure

- `apps/desktop/` — Electron app (main + renderer)
- `packages/` — Core framework packages (forked from pi-gui)
- `extensions/` — Desktop extensions (bid review, etc.)
- `vendor/` — Vendored genoffice packages
- `skills/` — Custom Pi skills

## Workflow

- Define success criteria before coding; if unclear, stop and clarify.
- Desktop work must be verified on the real Electron surface, not only by unit tests.
- Commit in small focused checkpoints.
- Keep the main pane conversation-first: transcript, tool timeline, composer, and session state are the priority.
- Keep the desktop renderer/main/preload boundary tight; avoid broad Node exposure to the renderer.

## Safety

- Never delete user session history, cached transcripts, screenshots, or temp artifacts without approval.
- Treat files you didn't edit as read-only when multiple agents may be working.
- Ask before destructive commands or history rewrites.
