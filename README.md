# Academic Life Dashboard

A pixel-art retro desktop dashboard for academic life — daily priorities, a
week planner, habit tracking, book & career pipelines, and a floating
typewriter-style focus widget, with a built-in lofi/internet radio player.
Built with Electron.



<img width="1907" height="1037" alt="Screenshot 2026-08-19 150653" src="https://github.com/user-attachments/assets/325d6a74-7440-4eee-a695-1b9d630f934d" />
<img width="1501" height="1015" alt="Screenshot 2026-08-19 150707" src="https://github.com/user-attachments/assets/f9ba1463-d95e-441f-827e-53e3be3059f2" />
<img width="579" height="556" alt="Screenshot 2026-08-19 150726" src="https://github.com/user-attachments/assets/3a43af02-82ee-4c4f-b8eb-e33bf237f469" />
<img width="387" height="482" alt="Screenshot 2026-08-19 150734" src="https://github.com/user-attachments/assets/04f73eb6-0fc4-429b-884b-09dc81d8cba8" />



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
