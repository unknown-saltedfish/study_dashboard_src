const { useState, useEffect, useRef, useMemo } = React;

const TIMEZONE = "Asia/Kolkata";
const ORDERED_DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri", "Sat", "Sun"];

function getKolkataDateInfo() {
  const now = new Date();
  const formatterDate = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit"
  });
  const parts = formatterDate.formatToParts(now);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;

  const formatterDay = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, weekday: "short"
  });
  const rawDay = formatterDay.format(now);
  const dayMap = { "Mon": "Mon", "Tue": "Tues", "Wed": "Wed", "Thu": "Thurs", "Fri": "Fri", "Sat": "Sat", "Sun": "Sun" };

  return {
    dateStr: `${y}-${m}-${d}`,
    dayKey: dayMap[rawDay] || rawDay
  };
}

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
}

function formatDuration(sec) {
  if (isNaN(sec) || !isFinite(sec)) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function App() {
  const [state, setState] = useState(null);
  const [activeTab, setActiveTab] = useState("priorities");
  const [confirmModal, setConfirmModal] = useState(null);
  const [toast, setToast] = useState(null);

  // Audio References & Playback States
  const localAudioRef = useRef(null);
  const [isLocalPlaying, setIsLocalPlaying] = useState(false);
  const [localCurrentTime, setLocalCurrentTime] = useState(0);
  const [localDuration, setLocalDuration] = useState(0);

  const streamAudioRef = useRef(null);
  const [isStreamPlaying, setIsStreamPlaying] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const fetchState = async () => {
      const res = await window.retroAPI.getState();
      if (res) {
        const info = getKolkataDateInfo();
        let updated = { ...res };
        let needsSave = false;
        
        if (updated.meta.todayDate !== info.dateStr) {
          updated.meta.todayDate = info.dateStr;
          updated.meta.todayDayKey = info.dayKey;
          updated.todayTopPriorities = {
            date: info.dateStr,
            dayKey: info.dayKey,
            isCustomized: false,
            items: (updated.weekAtAGlance[info.dayKey] || []).map((t, index) => ({
              id: generateId('tp'),
              text: t.text,
              done: t.done,
              fromWeekTaskId: t.id,
              pinned: false,
              hidden: false,
              order: index + 1
            }))
          };
          needsSave = true;
        }

        // FIXED: Migration 1: Carry over legacy youtube structures to streaming modes
        if (!updated.lofiPlayer || updated.lofiPlayer.mode === "youtube" || !updated.lofiPlayer.streamUrl) {
          updated.lofiPlayer = {
            ...(updated.lofiPlayer || {}),
            mode: "stream",
            streamUrl: "https://ice.somafm.com/groovesalad",
            streamName: "SomaFM — Groove Salad"
          };
          needsSave = true;
        }

        // FIXED: Migration 2: Batch-convert legacy local lists to valid native file urls
        if (updated.lofiPlayer && updated.lofiPlayer.localFiles && updated.lofiPlayer.localFiles.length > 0) {
          const hasMissingUrls = updated.lofiPlayer.localFiles.some(f => !f.url);
          if (hasMissingUrls) {
            const migratedFiles = await Promise.all(
              updated.lofiPlayer.localFiles.map(async (f) => {
                if (f.url) return f;
                try {
                  const nativeUrl = await window.retroAPI.pathToFileUrl(f.path);
                  return { ...f, url: nativeUrl };
                } catch (err) {
                  console.error("Local file sync parse error:", err);
                  return f;
                }
              })
            );
            updated.lofiPlayer.localFiles = migratedFiles;
            needsSave = true;
          }
        }

        if (needsSave) {
          await window.retroAPI.saveState(updated);
        }
        setState(updated);
      }
    };

    fetchState();

    const unsub = window.retroAPI.onStateUpdated((freshState) => {
      setState(freshState);
    });
    return unsub;
  }, []);

  const saveState = async (nextState) => {
    if (nextState.todayTopPriorities && !nextState.todayTopPriorities.isCustomized) {
      const currentDay = nextState.meta.todayDayKey || getKolkataDateInfo().dayKey;
      const weekTasks = nextState.weekAtAGlance[currentDay] || [];
      nextState.todayTopPriorities.items = weekTasks.map((t, index) => {
        const existing = (nextState.todayTopPriorities.items || []).find(old => old.fromWeekTaskId === t.id);
        return {
          id: existing ? existing.id : generateId('tp'),
          text: t.text,
          done: t.done,
          fromWeekTaskId: t.id,
          pinned: existing ? existing.pinned : false,
          hidden: existing ? existing.hidden : false,
          order: index + 1
        };
      });
    }

    setState(nextState);
    await window.retroAPI.saveState(nextState);
  };

  const handleSelectDirectory = async () => {
    const res = await window.retroAPI.selectLocalDirectory();
    if (res) {
      const nextLofi = {
        ...state.lofiPlayer,
        mode: "local",
        localPath: res.path,
        localFiles: res.files,
        currentIndex: 0
      };
      saveState({ ...state, lofiPlayer: nextLofi });
      showToast(`LOADED ${res.files.length} TRACKS`);
    }
  };

  // Sync Master Volume Slider
  useEffect(() => {
    if (state?.lofiPlayer) {
      if (localAudioRef.current) localAudioRef.current.volume = state.lofiPlayer.volume;
      if (streamAudioRef.current) streamAudioRef.current.volume = state.lofiPlayer.volume;
    }
  }, [state?.lofiPlayer?.volume]);

  // Player Handlers
  const toggleStreamPlayback = () => {
    if (!streamAudioRef.current) return;
    if (isStreamPlaying) {
      streamAudioRef.current.pause();
      setIsStreamPlaying(false);
    } else {
      if (localAudioRef.current) {
        localAudioRef.current.pause();
        setIsLocalPlaying(false);
      }
      streamAudioRef.current.play().catch(e => console.error("Stream access block:", e));
      setIsStreamPlaying(true);
    }
  };

  const toggleLocalPlayback = () => {
    if (!localAudioRef.current) return;
    if (isLocalPlaying) {
      localAudioRef.current.pause();
      setIsLocalPlaying(false);
    } else {
      if (streamAudioRef.current) {
        streamAudioRef.current.pause();
        setIsStreamPlaying(false);
      }
      localAudioRef.current.play().catch(e => console.error(e));
      setIsLocalPlaying(true);
    }
  };

  const handleNextLocalTrack = () => {
    if (!state || state.lofiPlayer.localFiles.length === 0) return;
    let nextIndex = state.lofiPlayer.currentIndex + 1;
    if (state.lofiPlayer.shuffle) {
      nextIndex = Math.floor(Math.random() * state.lofiPlayer.localFiles.length);
    } else if (nextIndex >= state.lofiPlayer.localFiles.length) {
      nextIndex = 0;
    }
    const nextLofi = { ...state.lofiPlayer, currentIndex: nextIndex };
    saveState({ ...state, lofiPlayer: nextLofi });
    setIsLocalPlaying(false);
    setLocalCurrentTime(0);
    setTimeout(() => {
      if (localAudioRef.current) {
        localAudioRef.current.play().then(() => setIsLocalPlaying(true)).catch(e => console.error(e));
      }
    }, 150);
  };

  const handleLocalSeek = (e) => {
    const targetVal = parseFloat(e.target.value);
    if (localAudioRef.current) {
      localAudioRef.current.currentTime = targetVal;
      setLocalCurrentTime(targetVal);
    }
  };

  if (!state) return null;

  const currentLocalTrack = state.lofiPlayer.localFiles[state.lofiPlayer.currentIndex];

  return (
    <div className="flex h-screen w-screen bg-[#0B0B0B] text-[#F3EBDD] select-none overflow-hidden">
      
      {/* SIDEBAR: RETRO DESK CONSOLE */}
      <aside className="w-80 bg-[#111111] border-r-4 border-[#111111] flex flex-col flex-shrink-0 z-20">
        <div className="p-4 border-b-4 border-[#111111] bg-[#1a1a1a]">
          <div className="flex items-center space-x-3">
            <span className="text-2xl text-[#C9473D]">⌨</span>
            <div>
              <h1 className="text-pixel-base font-black text-[#C9473D] tracking-wide uppercase typewriter-title">ACADEMIC DESK</h1>
              <div className="text-pixel-xs text-[#B8AA97] mt-1 font-bold">
                {state.meta.todayDayKey.toUpperCase()} // {state.meta.todayDate}
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-2 overflow-y-auto">
          <NavItem active={activeTab === 'priorities'} onClick={() => setActiveTab('priorities')} code="01" label="PRIORITIES & EXAMS" />
          <NavItem active={activeTab === 'week'} onClick={() => setActiveTab('week')} code="02" label="WEEK master PLAN" />
          <NavItem active={activeTab === 'habits'} onClick={() => setActiveTab('habits')} code="03" label="HABIT MATRIX" />
          <NavItem active={activeTab === 'books'} onClick={() => setActiveTab('books')} code="04" label="BOOK LIST" />
          <NavItem active={activeTab === 'gigs'} onClick={() => setActiveTab('gigs')} code="05" label="CAREER PIPELINE" />
          <NavItem active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} code="06" label="SETTINGS & BACKUP" />
        </nav>

        {/* FIXED: Replaced YouTube Embed with high-contrast, fully reliable Audio Station stream configurations */}
        <div className="p-3 border-t-4 border-[#111111] bg-[#1a1a1a]">
          <div className="text-pixel-xs font-bold text-[#F3EBDD] mb-2 uppercase flex items-center justify-between">
            <span>♪ RETRO STREAM</span>
            <select
              value={state.lofiPlayer.mode}
              onChange={(e) => {
                if (localAudioRef.current) {
                  localAudioRef.current.pause();
                  setIsLocalPlaying(false);
                }
                if (streamAudioRef.current) {
                  streamAudioRef.current.pause();
                  setIsStreamPlaying(false);
                }
                saveState({ ...state, lofiPlayer: { ...state.lofiPlayer, mode: e.target.value } });
              }}
              className="bg-[#0B0B0B] text-[#F3EBDD] text-pixel-xs border border-[#111111] p-1 focus:border-[#C9473D]"
            >
              <option value="stream">STREAM</option>
              <option value="local">LOCAL MP3</option>
            </select>
          </div>

          {state.lofiPlayer.mode === 'stream' ? (
            <div className="space-y-2 text-pixel-xs font-bold text-cream">
              <div className="text-pixel-xs text-[#B8AA97] mb-1">STATION PRESET:</div>
              <select
                value={
                  ["https://ice.somafm.com/groovesalad", 
                   "https://ice.somafm.com/dronezone", 
                   "https://ice.somafm.com/secretagent", 
                   "https://ice.somafm.com/spacestation", 
                   "https://ice.somafm.com/lush"].includes(state.lofiPlayer.streamUrl)
                    ? state.lofiPlayer.streamUrl
                    : "custom"
                }
                onChange={(e) => {
                  const val = e.target.value;
                  let targetUrl = val;
                  let targetName = "Custom URL";
                  if (val === "https://ice.somafm.com/groovesalad") targetName = "SomaFM — Groove Salad";
                  else if (val === "https://ice.somafm.com/dronezone") targetName = "SomaFM — Drone Zone";
                  else if (val === "https://ice.somafm.com/secretagent") targetName = "SomaFM — Secret Agent";
                  else if (val === "https://ice.somafm.com/spacestation") targetName = "SomaFM — Space Station Soma";
                  else if (val === "https://ice.somafm.com/lush") targetName = "SomaFM — Lush";

                  if (streamAudioRef.current) {
                    streamAudioRef.current.pause();
                    setIsStreamPlaying(false);
                  }

                  saveState({
                    ...state,
                    lofiPlayer: {
                      ...state.lofiPlayer,
                      streamUrl: targetUrl === "custom" ? "" : targetUrl,
                      streamName: targetName
                    }
                  });
                }}
                className="w-full bg-[#0B0B0B] text-[#F3EBDD] text-pixel-xs p-1 border border-[#111111] focus:border-[#C9473D]"
              >
                <option value="https://ice.somafm.com/groovesalad">Groove Salad</option>
                <option value="https://ice.somafm.com/dronezone">Drone Zone</option>
                <option value="https://ice.somafm.com/secretagent">Secret Agent</option>
                <option value="https://ice.somafm.com/spacestation">Space Station</option>
                <option value="https://ice.somafm.com/lush">Lush</option>
                <option value="custom">Custom URL...</option>
              </select>

              {(!["https://ice.somafm.com/groovesalad", 
                  "https://ice.somafm.com/dronezone", 
                  "https://ice.somafm.com/secretagent", 
                  "https://ice.somafm.com/spacestation", 
                  "https://ice.somafm.com/lush"].includes(state.lofiPlayer.streamUrl) || 
                 state.lofiPlayer.streamUrl === "") && (
                <input
                  type="text"
                  value={state.lofiPlayer.streamUrl}
                  onChange={(e) => {
                    if (streamAudioRef.current) {
                      streamAudioRef.current.pause();
                      setIsStreamPlaying(false);
                    }
                    saveState({ ...state, lofiPlayer: { ...state.lofiPlayer, streamUrl: e.target.value, streamName: "Custom URL" } });
                  }}
                  placeholder="CUSTOM URL..."
                  className="w-full bg-[#0B0B0B] text-[#F3EBDD] text-pixel-xs p-1 border border-[#111111] focus:border-[#C9473D]"
                />
              )}

              <div className="p-2 bg-[#0B0B0B] border border-[#111111]">
                <div className="flex justify-between items-center text-pixel-xs">
                  <span className="text-[#C9473D] animate-pulse">● LIVE</span>
                  <span className="truncate text-pixel-xs max-w-[120px]">{state.lofiPlayer.streamName}</span>
                </div>
                
                <div className="flex justify-between items-center mt-2.5">
                  <button onClick={toggleStreamPlayback} className="bg-[#C9473D] text-[#F3EBDD] px-2 py-1 text-pixel-xs">
                    [ {isStreamPlaying ? "PAUSE" : "PLAY"} ]
                  </button>
                </div>

                <div className="mt-2.5 flex items-center space-x-1 text-pixel-xs text-[#B8AA97]">
                  <span>VOL</span>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={state.lofiPlayer.volume}
                    onChange={(e) => {
                      const vol = parseFloat(e.target.value);
                      if (streamAudioRef.current) streamAudioRef.current.volume = vol;
                      saveState({ ...state, lofiPlayer: { ...state.lofiPlayer, volume: vol } });
                    }}
                    className="w-full accent-[#C9473D]"
                  />
                </div>
                <audio
                  ref={streamAudioRef}
                  src={state.lofiPlayer.streamUrl}
                  preload="none"
                  onError={() => {
                    setIsStreamPlaying(false);
                    const code = streamAudioRef.current?.error?.code;
                    showToast(`STREAM FAILED (code ${code ?? "?"}) — CHECK URL/NETWORK`);
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-pixel-xs font-bold">
              <button onClick={handleSelectDirectory} className="w-full bg-[#0B0B0B] hover:bg-[#1a1a1a] text-[#F3EBDD] p-1 border border-[#111111] text-pixel-xs uppercase">
                [ CHOOSE LOCAL PATH ]
              </button>
              {state.lofiPlayer.localFiles.length > 0 ? (
                <div className="p-2 bg-[#0B0B0B] border border-[#111111]">
                  <div className="truncate text-[#C9473D] mb-1">TRACK: {currentLocalTrack?.name}</div>
                  
                  {/* Progress Seek Bar */}
                  <div className="flex items-center justify-between text-pixel-xs text-[#B8AA97] mb-1">
                    <span>{formatDuration(localCurrentTime)}</span>
                    <input
                      type="range"
                      min="0"
                      max={localDuration || 100}
                      value={localCurrentTime}
                      onChange={handleLocalSeek}
                      className="mx-2 flex-1 accent-[#C9473D] h-1"
                    />
                    <span>{formatDuration(localDuration)}</span>
                  </div>

                  <div className="flex justify-between items-center mt-2">
                    <button onClick={toggleLocalPlayback} className="bg-[#C9473D] text-[#F3EBDD] px-2 py-1 text-pixel-xs">[ {isLocalPlaying ? "PAUSE" : "PLAY"} ]</button>
                    <button onClick={handleNextLocalTrack} className="bg-[#C9473D] text-[#F3EBDD] px-2 py-1 text-pixel-xs">[ NEXT ]</button>
                  </div>
                  
                  <div className="mt-2 flex items-center space-x-1 text-pixel-xs text-[#B8AA97]">
                    <span>VOL</span>
                    <input
                      type="range" min="0" max="1" step="0.05"
                      value={state.lofiPlayer.volume}
                      onChange={(e) => {
                        const vol = parseFloat(e.target.value);
                        if (localAudioRef.current) localAudioRef.current.volume = vol;
                        saveState({ ...state, lofiPlayer: { ...state.lofiPlayer, volume: vol } });
                      }}
                      className="w-full accent-[#C9473D]"
                    />
                  </div>
                  <audio
                    ref={localAudioRef}
                    src={currentLocalTrack ? currentLocalTrack.url : ""}
                    onEnded={handleNextLocalTrack}
                    onTimeUpdate={() => {
                      if (localAudioRef.current) setLocalCurrentTime(localAudioRef.current.currentTime);
                    }}
                    onLoadedMetadata={() => {
                      if (localAudioRef.current) setLocalDuration(localAudioRef.current.duration);
                    }}
                    onError={() => {
                      setIsLocalPlaying(false);
                      const code = localAudioRef.current?.error?.code;
                      showToast(`TRACK FAILED TO LOAD (code ${code ?? "?"})`);
                    }}
                  />
                </div>
              ) : (
                <div className="text-pixel-xs text-[#B8AA97] text-center uppercase border border-dashed border-[#111111] p-2">EMPTY DIRECTORY</div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* MAIN DOCUMENT SLIP SHEET */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b-4 border-[#111111] bg-[#111111] px-6 flex items-center justify-between">
          <h2 className="text-pixel-base font-bold uppercase tracking-wider text-[#C9473D] typewriter-title">
            {activeTab.toUpperCase()} DISPATCH
          </h2>
          <div className="text-pixel-xs bg-[#0B0B0B] border border-[#111111] px-2 py-1 text-[#B8AA97]">
            ASIA / KOLKATA (IST)
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 bg-[#0B0B0B]">
          {activeTab === 'priorities' && <PrioritiesAndDeadlinesModule state={state} saveState={saveState} showToast={showToast} setConfirmModal={setConfirmModal} />}
          {activeTab === 'week' && <WeekModule state={state} saveState={saveState} showToast={showToast} setConfirmModal={setConfirmModal} />}
          {activeTab === 'habits' && <HabitsModule state={state} saveState={saveState} showToast={showToast} setConfirmModal={setConfirmModal} />}
          {activeTab === 'books' && <BooksModule state={state} saveState={saveState} showToast={showToast} setConfirmModal={setConfirmModal} />}
          {activeTab === 'gigs' && <GigsModule state={state} saveState={saveState} showToast={showToast} setConfirmModal={setConfirmModal} />}
          {activeTab === 'settings' && <SettingsModule state={state} saveState={saveState} showToast={showToast} setConfirmModal={setConfirmModal} />}
        </div>
      </main>

      {/* CONFIRM ACTION MODAL */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="document-sheet p-6 max-w-sm w-full">
            <h3 className="text-pixel-base font-black text-[#C9473D] mb-2 uppercase tracking-wide">[ ! WARNING ]</h3>
            <p className="text-pixel-sm leading-relaxed mb-4 text-[#111111]">{confirmModal.message}</p>
            <div className="flex justify-end space-x-2">
              <button onClick={() => setConfirmModal(null)} className="btn-mechanical muted text-pixel-xs">Cancel</button>
              <button onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }} className="btn-mechanical red text-pixel-xs">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST STAMP */}
      {toast && (
        <div className="fixed bottom-6 right-6 retro-stamp red border-2 border-[#111111] px-4 py-2.5 shadow-2xl text-pixel-xs uppercase z-50">
          STAMPED: {toast}
        </div>
      )}
    </div>
  );
}

function NavItem({ active, onClick, code, label }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center space-x-3 px-3 py-3.5 text-left text-pixel-xs font-bold uppercase border-2 border-[#111111] transition-all ${
        active ? 'bg-[#C9473D] text-[#F3EBDD]' : 'bg-[#0B0B0B] text-[#B8AA97] hover:text-[#F3EBDD]'
      }`}
    >
      <span className={active ? "text-[#F3EBDD]" : "text-[#C9473D]"}>{code}</span>
      <span className="typewriter-title">{label}</span>
    </button>
  );
}

// Merged Module: Priorities & Deadlines Tab (Expanded to fill wide screens)
function PrioritiesAndDeadlinesModule({ state, saveState, showToast, setConfirmModal }) {
  const [taskText, setTaskText] = useState("");
  const items = state.todayTopPriorities.items || [];

  const [dTitle, setDTitle] = useState("");
  const [dDate, setDDate] = useState("");
  const [dCategory, setDCategory] = useState("Coursework");
  const [dNotes, setDNotes] = useState("");

  const deadlines = state.deadlines || [];
  const today = getKolkataDateInfo().dateStr;

  const handleAddPriority = (e) => {
    e.preventDefault();
    if (!taskText.trim()) return;
    const newItem = {
      id: generateId('tp'),
      text: taskText.trim(),
      done: false,
      fromWeekTaskId: null,
      pinned: false,
      hidden: false,
      order: items.length + 1
    };
    saveState({
      ...state,
      todayTopPriorities: {
        ...state.todayTopPriorities,
        isCustomized: true,
        items: [...items, newItem]
      }
    });
    setTaskText("");
    showToast("PRIORITY TYPED");
  };

  const handleSaveDeadline = (e) => {
    e.preventDefault();
    if (!dTitle.trim() || !dDate) return;
    const record = {
      id: generateId('d'),
      title: dTitle.trim(),
      dueDate: dDate,
      category: dCategory,
      notes: dNotes.trim(),
      status: "Upcoming"
    };
    saveState({ ...state, deadlines: [...deadlines, record] });
    setDTitle("");
    setDDate("");
    setDNotes("");
    showToast("DEADLINE REGISTERED");
  };

  const toggleDonePriority = (id) => {
    const nextItems = items.map(item => {
      if (item.id === id) {
        const nextDone = !item.done;
        // Keep week master plan item synced if linked
        let updatedWeek = { ...state.weekAtAGlance };
        if (item.fromWeekTaskId) {
          const currentDay = state.meta.todayDayKey || getKolkataDateInfo().dayKey;
          updatedWeek[currentDay] = (state.weekAtAGlance[currentDay] || []).map(wt => 
            wt.id === item.fromWeekTaskId ? { ...wt, done: nextDone } : wt
          );
        }
        return { ...item, done: nextDone };
      }
      return item;
    });

    saveState({
      ...state,
      todayTopPriorities: { ...state.todayTopPriorities, items: nextItems }
    });
  };

  const togglePinPriority = (id) => {
    const nextItems = items.map(item => item.id === id ? { ...item, pinned: !item.pinned } : item);
    saveState({
      ...state,
      todayTopPriorities: { ...state.todayTopPriorities, isCustomized: true, items: nextItems }
    });
  };

  const toggleHidePriority = (id) => {
    const nextItems = items.map(item => item.id === id ? { ...item, hidden: !item.hidden } : item);
    saveState({
      ...state,
      todayTopPriorities: { ...state.todayTopPriorities, isCustomized: true, items: nextItems }
    });
  };

  const toggleDeadlineStatus = (id) => {
    const next = deadlines.map(d => d.id === id ? { ...d, status: d.status === "Done" ? "Upcoming" : "Done" } : d);
    saveState({ ...state, deadlines: next });
  };

  const handleRemoveDeadline = (id, label) => {
    setConfirmModal({
      message: `CONFIRM DELETION OF "${label}"?`,
      onConfirm: () => {
        saveState({ ...state, deadlines: deadlines.filter(d => d.id !== id) });
        showToast("ENTRY STRICKEN");
      }
    });
  };

  const handleManualSyncDay = () => {
    const todayDay = state.meta.todayDayKey || getKolkataDateInfo().dayKey;
    const weekTasks = state.weekAtAGlance[todayDay] || [];
    const refreshed = weekTasks.map((t, index) => ({
      id: generateId('tp'),
      text: t.text,
      done: t.done,
      fromWeekTaskId: t.id,
      pinned: false,
      hidden: false,
      order: index + 1
    }));
    saveState({
      ...state,
      todayTopPriorities: {
        date: state.meta.todayDate,
        dayKey: todayDay,
        isCustomized: false,
        items: refreshed
      }
    });
    showToast(`SYNCED WITH {todayDay.toUpperCase()}`);
  };

  const sortedDeadlines = useMemo(() => {
    return [...deadlines].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [deadlines]);

  const sortedPriorities = useMemo(() => {
    return items
      .filter(i => !i.hidden)
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }, [items]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      
      {/* FIXED: Focus Envelope redesigned to block-level container to resolve all label overlaps */}
      <div className="focus-envelope">
        <div className="flex justify-between items-center pb-2">
          <span className="text-[#C9473D] font-bold text-pixel-xs uppercase tracking-wider">
            [ {state.meta.todayDayKey.toUpperCase()}'S FOCUS ]
          </span>
          <button onClick={handleManualSyncDay} className="btn-mechanical text-pixel-xs py-1 px-3">
            [ 📅 SYNC WITH {state.meta.todayDayKey.slice(0, 4).toUpperCase()} ]
          </button>
        </div>

        <div className="divider-dotted-dark my-2"></div>

        <div className="space-y-2 py-2">
          <h3 className="text-pixel-md font-black text-[#111111] uppercase tracking-wide typewriter-title">
            HIGH-LEVERAGE EXECUTION
          </h3>
          <p className="text-pixel-sm text-gray-700 leading-relaxed">
            Concentrate on what moves the needle today. Pinned sheets stay at the top of your carriage list.
          </p>
        </div>

        <div className="border-t-2 border-[#111111] pt-3 mt-2 flex justify-between items-center text-pixel-xs text-gray-600 font-bold uppercase">
          <span>COMPLETED: {items.filter(i => i.done && !i.hidden).length} / {items.filter(i => !i.hidden).length}</span>
          <span className="text-[#C9473D]">STATUS // VERIFIED</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        
        {/* PRIORITIES REGISTER */}
        <div className="document-sheet p-6 min-h-[480px]">
          <h3 className="text-pixel-base font-black pb-3 divider-dotted-red mb-4 uppercase font-typewriter tracking-wider text-[#111111]">TODAY'S PRIORITIES</h3>
          
          <form onSubmit={handleAddPriority} className="flex gap-2 mb-4">
            <input
              type="text"
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              placeholder="ADD HIGH-PRIORITY TASK FOR TODAY..."
              className="flex-1 text-pixel-sm input-document"
            />
            <button type="submit" className="btn-mechanical red text-pixel-xs whitespace-nowrap">
              + ADD PRIORITY
            </button>
          </form>

          <div className="space-y-2.5">
            {sortedPriorities.map(item => (
              <div key={item.id} className="task-slip">
                <div className="flex items-center space-x-3 truncate">
                  <div
                    onClick={() => toggleDonePriority(item.id)}
                    className={`task-slip-checkbox ${item.done ? 'checked' : ''}`}
                  />
                  <span className={`text-pixel-sm truncate font-bold uppercase ${item.done ? 'line-through text-gray-500' : 'text-[#111111]'}`}>
                    {item.text}
                  </span>
                </div>
                <div className="flex items-center space-x-1.5 text-pixel-xs">
                  <button onClick={() => togglePinPriority(item.id)} className="btn-mechanical text-pixel-xs font-bold px-2 py-1">
                    {item.pinned ? "UNPIN" : "PIN"}
                  </button>
                  <button onClick={() => toggleHidePriority(item.id)} className="btn-mechanical red text-pixel-xs font-bold px-2 py-1">
                    HIDE
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* DEADLINES DOSSIER */}
        <div className="document-sheet p-6 min-h-[480px] space-y-4">
          <h3 className="text-pixel-base font-black pb-3 divider-dotted-red mb-2 uppercase font-typewriter tracking-wider text-[#111111]">DEADLINES & EXAMS</h3>
          
          <form onSubmit={handleSaveDeadline} className="grid grid-cols-2 gap-3 text-pixel-xs font-bold text-ink bg-white p-4 border-2 border-[#111111]">
            <div>
              <label className="block mb-1 text-[#111111]">TITLE</label>
              <input type="text" required value={dTitle} onChange={(e) => setDTitle(e.target.value)} placeholder="e.g. COMPILER EXAM" className="w-full text-pixel-sm p-1.5" />
            </div>
            <div>
              <label className="block mb-1 text-[#111111]">DATE</label>
              <input type="date" required value={dDate} onChange={(e) => setDDate(e.target.value)} className="w-full text-pixel-sm p-1.5 font-mono" />
            </div>
            <div>
              <label className="block mb-1 text-[#111111]">TYPE</label>
              <select value={dCategory} onChange={(e) => setDCategory(e.target.value)} className="w-full text-pixel-sm p-1.5 bg-[#F3EBDD]">
                <option value="Coursework">Coursework</option>
                <option value="Exam">Exam</option>
                <option value="Application">Application</option>
              </select>
            </div>
            <div>
              <label className="block mb-1 text-[#111111]">NOTES</label>
              <input type="text" value={dNotes} onChange={(e) => setDNotes(e.target.value)} placeholder="Optional notes" className="w-full text-pixel-sm p-1.5" />
            </div>
            <div className="col-span-2 pt-1">
              <button type="submit" className="w-full btn-mechanical red text-pixel-xs py-2">
                LOG DEADLINE RECORD
              </button>
            </div>
          </form>

          <div className="space-y-2.5">
            {sortedDeadlines.map(d => {
              const isOverdue = d.dueDate < today && d.status !== "Done";
              return (
                <div key={d.id} className={`task-slip ${d.status === "Done" ? "opacity-50" : ""}`}>
                  <div>
                    <div className="text-pixel-sm font-bold text-[#111111]">{d.title}</div>
                    <div className="text-pixel-xs text-gray-500 font-bold mt-1">DUE: {d.dueDate} // TYPE: {d.category}</div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    {isOverdue && <span className="stamp-badge red text-pixel-xs">OVERDUE</span>}
                    <button onClick={() => toggleDeadlineStatus(d.id)} className="btn-mechanical text-pixel-xs px-2 py-1 bg-cream">
                      {d.status === "Done" ? "UNDONE" : "RESOLVED"}
                    </button>
                    <button onClick={() => handleRemoveDeadline(d.id, d.title)} className="text-red-500 font-bold px-1 text-pixel-base">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

// Week at a Glance Module
function WeekModule({ state, saveState, showToast, setConfirmModal }) {
  const [selectedDay, setSelectedDay] = useState("Mon");
  const [bulkText, setBulkText] = useState("");
  const weekData = state.weekAtAGlance || {};

  const handleBulkAdd = (e) => {
    e.preventDefault();
    if (!bulkText.trim()) return;
    const rows = bulkText.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);
    const parsed = rows.map(txt => ({
      id: generateId(selectedDay.toLowerCase()),
      text: txt,
      done: false
    }));

    const nextWeek = {
      ...weekData,
      [selectedDay]: [...(weekData[selectedDay] || []), ...parsed]
    };
    saveState({ ...state, weekAtAGlance: nextWeek });
    setBulkText("");
    showToast(`COMMITTED TO ${selectedDay.toUpperCase()}`);
  };

  const copyToDay = (task, targetDay) => {
    const copy = { ...task, id: generateId(targetDay.toLowerCase()) };
    const nextWeek = {
      ...weekData,
      [targetDay]: [...(weekData[targetDay] || []), copy]
    };
    saveState({ ...state, weekAtAGlance: nextWeek });
    showToast(`COPIED TO ${targetDay.toUpperCase()}`);
  };

  const removeTask = (day, id, text) => {
    setConfirmModal({
      message: `DELETE "${text}" FROM ${day.toUpperCase()}?`,
      onConfirm: () => {
        const nextWeek = {
          ...weekData,
          [day]: weekData[day].filter(t => t.id !== id)
        };
        saveState({ ...state, weekAtAGlance: nextWeek });
        showToast("REMOVED");
      }
    });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="document-sheet p-4 max-w-2xl mx-auto text-[#111111]">
        <h3 className="text-pixel-base font-black pb-2 divider-dotted mb-3 uppercase">BATCH LOG BLUEPRINT</h3>
        <form onSubmit={handleBulkAdd} className="space-y-3 text-pixel-xs font-bold">
          <div>
            <label className="block mb-1">TARGET DAY</label>
            <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} className="w-full text-pixel-sm bg-[#F3EBDD]">
              {ORDERED_DAYS.map(d => <option key={d} value={d}>{d.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <label className="block mb-1">PASTE TASKS (SEPARATED BY NEWLINE OR COMMA)</label>
            <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows="3" placeholder="Read Chapter 3..." className="w-full text-pixel-sm bg-[#F3EBDD] text-[#111111]" />
          </div>
          <button type="submit" className="w-full btn-mechanical red text-pixel-xs py-2">
            [ BATCH LOAD TASKS ]
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {ORDERED_DAYS.map(day => {
          const isToday = day === state.meta.todayDayKey;
          const tasks = weekData[day] || [];
          return (
            <div key={day} className={`document-sheet p-3 flex flex-col h-96 ${isToday ? 'border-4 border-[#C9473D]' : ''}`}>
              <div className="pb-1 border-b border-[#111111] text-pixel-xs font-bold text-[#111111] mb-2 flex justify-between items-center">
                <span>{day.toUpperCase()}</span>
                {isToday && <span className="stamp-badge red text-pixel-xs">TODAY</span>}
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 paper-scroll">
                {tasks.map(t => (
                  <div key={t.id} className="p-1.5 bg-[#FAF6EE] border border-[#111111] text-pixel-xs text-ink font-bold relative">
                    <div className="break-words mb-2 leading-tight">{t.text}</div>
                    <div className="flex justify-between items-center mt-1 border-t border-gray-300 pt-1">
                      <select
                        onChange={(e) => { copyToDay(t, e.target.value); e.target.value = ""; }}
                        defaultValue=""
                        className="text-pixel-xs bg-[#F3EBDD] border border-[#111111]"
                      >
                        <option value="" disabled>COPY...</option>
                        {ORDERED_DAYS.filter(d => d !== day).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <button onClick={() => removeTask(day, t.id, t.text)} className="text-red-500 font-bold">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Habits Module
function HabitsModule({ state, saveState, showToast, setConfirmModal }) {
  const [habitName, setHabitName] = useState("");
  const habits = state.habitTracker?.habits || [];
  const checkins = state.habitTracker?.checkins || [];

  const handleAdd = (e) => {
    e.preventDefault();
    if (!habitName.trim()) return;
    const newHabit = { id: generateId('h'), name: habitName.trim(), active: true };
    saveState({
      ...state,
      habitTracker: {
        ...(state.habitTracker || {}),
        habits: [...habits, newHabit]
      }
    });
    setHabitName("");
    showToast("HABIT COMMITTED");
  };

  const toggleCheck = (habitId, date) => {
    const nextCheckins = [...checkins];
    const matchIdx = nextCheckins.findIndex(c => c.habitId === habitId && c.date === date);
    if (matchIdx >= 0) {
      nextCheckins[matchIdx] = { ...nextCheckins[matchIdx], value: !nextCheckins[matchIdx].value };
    } else {
      nextCheckins.push({ date, habitId, value: true });
    }
    saveState({
      ...state,
      habitTracker: {
        ...(state.habitTracker || {}),
        checkins: nextCheckins
      }
    });
  };

  const removeHabit = (id, name) => {
    setConfirmModal({
      message: `ERASE "${name}" AND ALL HISTORICAL LOGS?`,
      onConfirm: () => {
        saveState({
          ...state,
          habitTracker: {
            habits: habits.filter(h => h.id !== id),
            checkins: checkins.filter(c => c.habitId !== id)
          }
        });
        showToast("RECORD REMOVED");
      }
    });
  };

  const past7Days = useMemo(() => {
    const list = [];
    const nowKolkata = new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
    for (let i = 6; i >= 0; i--) {
      const day = new Date(nowKolkata);
      day.setDate(day.getDate() - i);
      const yyyy = day.getFullYear();
      const mm = String(day.getMonth() + 1).padStart(2, '0');
      const dd = String(day.getDate()).padStart(2, '0');
      const dayName = ORDERED_DAYS[day.getDay() - 1] || "Sun";
      list.push({ date: `${yyyy}-${mm}-${dd}`, dayKey: dayName });
    }
    return list;
  }, []);

  const getStreak = (habitId) => {
    let streak = 0;
    const checkedDates = new Set(checkins.filter(c => c.habitId === habitId && c.value).map(c => c.date));
    const nowKolkata = new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
    let checkDate = new Date(nowKolkata);
    
    const formatDate = (d) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    let ds = formatDate(checkDate);
    if (!checkedDates.has(ds)) {
      checkDate.setDate(checkDate.getDate() - 1);
      ds = formatDate(checkDate);
      if (!checkedDates.has(ds)) return 0;
    }

    while (checkedDates.has(ds)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
      ds = formatDate(checkDate);
    }
    return streak;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="document-sheet p-6">
        <div className="flex justify-between items-center pb-3 divider-dotted mb-4">
          <h3 className="text-pixel-base font-black uppercase font-typewriter text-[#111111]">HABIT FORMATION PUNCH-CARD</h3>
          <form onSubmit={handleAdd} className="flex gap-2">
            <input type="text" value={habitName} onChange={(e) => setHabitName(e.target.value)} placeholder="NEW PROTOCOL..." className="text-pixel-xs p-1.5" />
            <button type="submit" className="btn-mechanical red text-pixel-xs">+ ADD</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-ink text-pixel-sm">
            <thead>
              <tr className="border-b-2 border-[#111111]">
                <th className="pb-2 text-[#111111]">HABIT PROTOCOL</th>
                <th className="pb-2 text-center text-[#111111]">STREAK</th>
                {past7Days.map(d => (
                  <th key={d.date} className="pb-2 text-center font-mono text-[#111111]">
                    <div>{d.dayKey}</div>
                    <div className="text-pixel-xs text-gray-500">{d.date.slice(5)}</div>
                  </th>
                ))}
                <th className="pb-2 text-right text-[#111111]">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-300">
              {habits.map(h => {
                const streak = getStreak(h.id);
                return (
                  <tr key={h.id}>
                    <td className="py-2.5 font-bold uppercase text-[#111111]">{h.name}</td>
                    <td className="py-2.5 text-center">
                      <span className="stamp-badge red text-pixel-xs font-bold font-mono">{streak} DAYS</span>
                    </td>
                    {past7Days.map(d => {
                      const active = checkins.some(c => c.habitId === h.id && c.date === d.date && c.value);
                      return (
                        <td key={d.date} className="py-2.5 text-center">
                          <button
                            onClick={() => toggleCheck(h.id, d.date)}
                            className={`w-6 h-6 border-2 border-[#111111] flex items-center justify-center font-bold text-pixel-xs mx-auto ${
                              active ? 'bg-[#111111] text-cream' : 'bg-[#F3EBDD]'
                            }`}
                          >
                            ✓
                          </button>
                        </td>
                      );
                    })}
                    <td className="py-2.5 text-right">
                      <button onClick={() => removeHabit(h.id, h.name)} className="text-red-500 font-bold hover:underline">STRIKE</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Book Tracker
function BooksModule({ state, saveState, showToast, setConfirmModal }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [status, setStatus] = useState("TBR");
  const [rating, setRating] = useState(5);
  const [notes, setNotes] = useState("");

  const books = state.bookTracker?.books || [];

  const handleCatalog = (e) => {
    e.preventDefault();
    if (!title.trim() || !author.trim()) return;
    const record = {
      id: generateId('b'),
      title: title.trim(),
      author: author.trim(),
      status,
      rating: status === "Finished" ? Number(rating) : null,
      notes: notes.trim()
    };
    saveState({
      ...state,
      bookTracker: { books: [...books, record] }
    });
    setTitle("");
    setAuthor("");
    setNotes("");
    showToast("VOLUME CATALOGED");
  };

  const updateStatus = (id, nextStatus) => {
    const nextList = books.map(b => b.id === id ? { ...b, status: nextStatus, rating: nextStatus === "Finished" ? 5 : null } : b);
    saveState({ ...state, bookTracker: { books: nextList } });
  };

  const handleRemove = (id, label) => {
    setConfirmModal({
      message: `STRIKE "${label}" FROM YOUR LIBRARY?`,
      onConfirm: () => {
        saveState({
          ...state,
          bookTracker: { books: books.filter(b => b.id !== id) }
        });
        showToast("STRICKEN");
      }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
      <div className="document-sheet p-4 h-fit">
        <h3 className="text-pixel-base font-black pb-2 divider-dotted mb-3 uppercase text-[#111111]">CATALOG VOLUME</h3>
        <form onSubmit={handleCatalog} className="space-y-3 text-pixel-xs font-bold text-ink">
          <div>
            <label className="block mb-1 text-[#111111]">BOOK TITLE *</label>
            <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-pixel-sm p-1.5" />
          </div>
          <div>
            <label className="block mb-1 text-[#111111]">AUTHOR *</label>
            <input type="text" required value={author} onChange={(e) => setAuthor(e.target.value)} className="w-full text-pixel-sm p-1.5" />
          </div>
          <div>
            <label className="block mb-1 text-[#111111]">STATUS</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full text-pixel-sm p-1.5 bg-[#F3EBDD]">
              <option value="TBR">TO BE READ</option>
              <option value="Reading">READING</option>
              <option value="Finished">FINISHED</option>
            </select>
          </div>
          {status === 'Finished' && (
            <div>
              <label className="block mb-1 text-[#111111]">RATING</label>
              <select value={rating} onChange={(e) => setRating(parseInt(e.target.value))} className="w-full text-pixel-sm p-1.5 bg-[#F3EBDD]">
                <option value="5">★★★★★</option>
                <option value="4">★★ optical</option>
                <option value="3">★★★</option>
                <option value="2">★★</option>
                <option value="1">★</option>
              </select>
            </div>
          )}
          <div>
            <label className="block mb-1 text-[#111111]">INSIGHT NOTES</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows="2" className="w-full text-pixel-sm bg-[#F3EBDD] text-[#111111]" />
          </div>
          <button type="submit" className="w-full btn-mechanical red text-pixel-xs py-2">
            CATALOG VOLUME
          </button>
        </form>
      </div>

      <div className="lg:col-span-2 space-y-4">
        {["Reading", "TBR", "Finished"].map(cat => {
          const list = books.filter(b => b.status === cat);
          return (
            <div key={cat} className="document-sheet p-4">
              <h4 className="text-pixel-base font-black pb-1 border-b border-[#111111] mb-3 text-[#111111] uppercase tracking-wider">{cat} REGISTRY</h4>
              <div className="space-y-2.5">
                {list.map(book => (
                  <div key={book.id} className="task-slip">
                    <div>
                      <div className="text-pixel-sm font-bold uppercase text-[#111111]">{book.title}</div>
                      <div className="text-pixel-xs text-gray-600 font-bold">BY {book.author.toUpperCase()}</div>
                      {book.rating && <div className="text-pixel-xs text-[#C9473D] mt-1 font-bold">{"★".repeat(book.rating)}</div>}
                      {book.notes && <div className="text-pixel-xs text-gray-500 italic mt-1 font-bold">"{book.notes}"</div>}
                    </div>
                    <div className="flex items-center space-x-1.5 text-pixel-xs">
                      {cat !== 'Reading' && <button onClick={() => updateStatus(book.id, "Reading")} className="btn-mechanical text-pixel-xs px-2 py-1">READ</button>}
                      {cat !== 'Finished' && <button onClick={() => updateStatus(book.id, "Finished")} className="btn-mechanical text-pixel-xs px-2 py-1">DONE</button>}
                      <button onClick={() => handleRemove(book.id, book.title)} className="text-red-500 font-bold px-1.5 text-pixel-base">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Internship Tracker
function GigsModule({ state, saveState, showToast, setConfirmModal }) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [pipeline, setPipeline] = useState("Interested");
  const [nextStep, setNextStep] = useState("");

  const items = state.internshipGigTracker?.items || [];

  const handleAdd = (e) => {
    e.preventDefault();
    if (!company.trim() || !role.trim()) return;
    const gig = {
      id: generateId('ig'),
      companyOrClient: company.trim(),
      role: role.trim(),
      status: pipeline,
      nextStep: nextStep.trim(),
      updatedAt: new Date().toISOString()
    };
    saveState({
      ...state,
      internshipGigTracker: { items: [...items, gig] }
    });
    setCompany("");
    setRole("");
    setNextStep("");
    showToast("APPLICATION LOGGED");
  };

  const updateStage = (id, nextStage) => {
    const nextList = items.map(g => g.id === id ? { ...g, status: nextStage, updatedAt: new Date().toISOString() } : g);
    saveState({ ...state, internshipGigTracker: { items: nextList } });
  };

  const handleRemove = (id, name) => {
    setConfirmModal({
      message: `STRIKE "${name}" FROM YOUR PIPELINE?`,
      onConfirm: () => {
        saveState({
          ...state,
          internshipGigTracker: { items: items.filter(g => g.id !== id) }
        });
        showToast("STRICKEN");
      }
    });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="document-sheet p-4 max-w-xl mx-auto">
        <h3 className="text-pixel-base font-black pb-2 divider-dotted mb-3 uppercase text-[#111111]">LOG PIPELINE LEAD</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-pixel-xs font-bold text-ink">
          <div>
            <label className="block mb-1 text-[#111111]">COMPANY/CLIENT *</label>
            <input type="text" required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. OPENAI" className="w-full text-pixel-sm p-1.5" />
          </div>
          <div>
            <label className="block mb-1 text-[#111111]">ROLE TITLE *</label>
            <input type="text" required value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. ML INTERN" className="w-full text-pixel-sm p-1.5" />
          </div>
          <div>
            <label className="block mb-1 text-[#111111]">STAGE</label>
            <select value={pipeline} onChange={(e) => setPipeline(e.target.value)} className="w-full text-pixel-sm p-1.5 bg-[#F3EBDD]">
              <option value="Interested">Interested</option>
              <option value="Applied">Applied</option>
              <option value="Interview">Interview</option>
              <option value="Offer">Offer</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="block mb-1 text-[#111111]">NEXT STEP</label>
            <input type="text" value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="e.g. TECH SCREEN" className="w-full text-pixel-sm p-1.5" />
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="w-full btn-mechanical red text-pixel-xs py-2">
              LOG APPLICATION
            </button>
          </div>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {["Interested", "Applied", "Interview", "Offer", "Rejected"].map(col => {
          const colGigs = items.filter(g => g.status === col);
          return (
            <div key={col} className="document-sheet p-3 min-h-[380px] flex flex-col">
              <div className="pb-1 border-b border-[#111111] text-pixel-xs font-bold text-ink mb-3 uppercase flex justify-between">
                <span>{col}</span>
                <span className="text-red-500">[{colGigs.length}]</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 paper-scroll">
                {colGigs.map(g => (
                  <div key={g.id} className="p-2 bg-[#FAF6EE] border border-[#111111] text-pixel-xs text-ink font-bold space-y-1.5">
                    <div>
                      <div className="font-bold text-pixel-sm uppercase">{g.companyOrClient}</div>
                      <div className="text-gray-500 font-mono mt-0.5">{g.role}</div>
                    </div>
                    {g.nextStep && <div className="text-red-500 uppercase text-pixel-xs">NEXT: {g.nextStep}</div>}
                    <div className="flex justify-between items-center pt-1 border-t border-gray-200">
                      <select
                        value={g.status}
                        onChange={(e) => updateStage(g.id, e.target.value)}
                        className="text-pixel-xs bg-[#F3EBDD] border border-[#111111]"
                      >
                        <option value="Interested">INTERESTED</option>
                        <option value="Applied">APPLIED</option>
                        <option value="Interview">INTERVIEW</option>
                        <option value="Offer">OFFER</option>
                        <option value="Rejected">REJECTED</option>
                      </select>
                      <button onClick={() => handleRemove(g.id, g.companyOrClient)} className="text-red-500 font-bold px-1.5 text-pixel-base">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Settings Module
function SettingsModule({ state, saveState, showToast, setConfirmModal }) {
  const fileInputRef = useRef(null);

  const triggerExport = () => {
    const rawData = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloader = document.createElement('a');
    downloader.setAttribute("href", rawData);
    downloader.setAttribute("download", `Academic_Dossier_Backup_${getKolkataDateInfo().dateStr}.json`);
    document.body.appendChild(downloader);
    downloader.click();
    downloader.remove();
    showToast("EXPORT COMPLETED");
  };

  const triggerImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const payload = JSON.parse(event.target.result);
        if (!payload.weekAtAGlance || !payload.deadlines) throw new Error("Invalid format");
        setConfirmModal({
          message: "RESTORE OVERWRITE CURRENT WORKSPACE?",
          onConfirm: () => {
            saveState(payload);
            showToast("BACKUP APPLIED");
          }
        });
      } catch (err) {
        alert("Restoration Failed: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const factoryReset = () => {
    setConfirmModal({
      message: "PURGE ALL DATABASE ENTRIES?",
      onConfirm: async () => {
        const info = getKolkataDateInfo();
        const fresh = {
          meta: {
            title: "Academic Life Dashboard",
            timezone: "Asia/Kolkata",
            todayDate: info.dateStr,
            todayDayKey: info.dayKey
          },
          lofiPlayer: {
            youtubeUrl: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
            autoplay: false,
            mode: "youtube",
            localPath: "",
            localFiles: [],
            currentIndex: 0,
            volume: 0.5,
            shuffle: false
          },
          weekAtAGlance: {
            Mon: [], Tues: [], Wed: [], Thurs: [], Fri: [], Sat: [], Sun: []
          },
          todayTopPriorities: {
            date: info.dateStr,
            dayKey: info.dayKey,
            items: [],
            isCustomized: false
          },
          deadlines: [],
          habitTracker: { habits: [], checkins: [] },
          bookTracker: { books: [] },
          internshipGigTracker: { items: [] },
          typewriterEnabled: true,
          muted: false,
          typewriterViewMode: "focus"
        };
        await saveState(fresh);
        showToast("FACTORY DATA RESET SUCCESSFUL");
      }
    });
  };

  const handleTypewriterToggle = (e) => {
    const val = e.target.checked;
    saveState({ ...state, typewriterEnabled: val });
    window.retroAPI.toggleTypewriter(val);
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="document-sheet p-6 space-y-5 text-ink">
        <h3 className="text-pixel-base font-black pb-2 divider-dotted mb-4 uppercase font-typewriter">SYSTEM CONFIG & BACKUPS</h3>
        
        <div className="space-y-3">
          <label className="flex items-center space-x-2 text-pixel-xs font-bold cursor-pointer text-ink">
            <input
              type="checkbox"
              checked={state.typewriterEnabled}
              onChange={handleTypewriterToggle}
              className="w-4 h-4 accent-[#C9473D]"
            />
            <span>SPAWN FLOATING TYPEWRITER WIDGET</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-[#111111]">
          <button onClick={triggerExport} className="btn-mechanical red text-pixel-xs py-2">
            [ EXPORT BACKUP ]
          </button>
          <button onClick={() => fileInputRef.current.click()} className="btn-mechanical text-pixel-xs py-2">
            [ RESTORE BACKUP ]
          </button>
          <input type="file" ref={fileInputRef} onChange={triggerImport} accept=".json" className="hidden" />
        </div>

        <div className="pt-4 border-t border-[#111111] flex justify-between items-center text-pixel-xs font-bold text-ink">
          <span>FACTORY ERASE</span>
          <button onClick={factoryReset} className="btn-mechanical red text-pixel-xs py-2">PURGE ALL</button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);