# Academic Life Dashboard

A pixel-art retro desktop dashboard for academic life — daily priorities, a
week planner, habit tracking, book & career pipelines, and a floating
typewriter-style focus widget, with a built-in lofi/internet radio player.
Built with Electron.

## Features

- **Today's Priorities** — daily task list, pulled from your Week Master Plan
- **Week Master Plan** — plan tasks per day of the week
- **Habit Matrix** — track recurring habits/check-ins
- **Book List** — reading tracker
- **Career Pipeline** — internship/job application tracker
- **Deadlines** — upcoming coursework/project deadlines
- **Floating Typewriter widget** — an always-on-top, frameless mini window for
  distraction-free focus on today's tasks
- **Retro Stream player** — internet radio (Icecast/Shoutcast URLs) or local
  MP3/WAV/OGG folder playback

## Running from source

```bash
npm install
npm start
```

## Building a Windows installer

```bash
npm install
npm run dist
```

This produces `release/AcademicDashboard-Setup-<version>.exe` — a full NSIS
installer with a setup wizard, desktop/start-menu shortcuts, and an
uninstaller. Requires internet access on first run (downloads Electron +
NSIS packaging tools).

## Data storage

App state is saved as a JSON file in your OS's Documents folder
(`academic-dashboard-state.json`) — nothing is sent anywhere else.

## License

MIT
