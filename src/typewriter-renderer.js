class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playSquare(freq, duration, delay = 0) {
    if (this.muted) return;
    this.init();

    setTimeout(() => {
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {
        console.error("Audio trigger failed:", e);
      }
    }, delay);
  }

  keyClickSound() {
    const freq = Math.floor(Math.random() * (950 - 750 + 1)) + 750;
    this.playSquare(freq, 0.02, 0);
    this.playSquare(freq / 2, 0.025, 8);
  }

  printSound() {
    const freq = Math.floor(Math.random() * (800 - 600 + 1)) + 600;
    this.playSquare(freq, 0.04);
  }

  checkSound() {
    this.playSquare(880, 0.06, 0);
    this.playSquare(1100, 0.08, 60);
  }

  uncheckSound() {
    this.playSquare(440, 0.06);
  }

  completionSound() {
    this.playSquare(880, 0.08, 0);
    this.playSquare(1100, 0.08, 90);
    this.playSquare(1320, 0.08, 180);
    this.playSquare(1760, 0.12, 270);
  }
}

const sounds = new SoundEngine();

let appState = null;
let hasCelebrated = false;

// Element Selectors
const paperSlotMask = document.getElementById('paper-slot-mask');
const paperEl = document.getElementById('paper');
const paperTitleEl = document.getElementById('paper-title');
const paperBodyEl = document.getElementById('paper-body');
const allDoneBanner = document.getElementById('all-done-banner');
const idlePanel = document.getElementById('idle-panel');
const statusProgress = document.getElementById('status-progress');

const btnPlus = document.getElementById('btn-plus');
const btnViewToggle = document.getElementById('btn-view-toggle');
const btnSoundToggle = document.getElementById('btn-sound-toggle');

const modalAddPlan = document.getElementById('modal-add-plan');
const planInputTextarea = document.getElementById('plan-input-textarea');
const btnPlanLoad = document.getElementById('btn-plan-load');
const btnPlanCancel = document.getElementById('btn-plan-cancel');

const modalCompletion = document.getElementById('modal-completion');
const sessionNoteInput = document.getElementById('session-note-input');
const btnCompleteSave = document.getElementById('btn-complete-save');
const btnCompleteSkip = document.getElementById('btn-complete-skip');

const modalAbort = document.getElementById('modal-abort');
const btnAbortLog = document.getElementById('btn-abort-log');
const btnAbortDiscard = document.getElementById('btn-abort-discard');
const btnAbortCancel = document.getElementById('btn-abort-cancel');

const CHECK_SVG = `<svg viewBox="0 0 10 10" style="width: 12px; height: 12px; fill: #F5EDE0;"><polygon points="1,5 4,8 9,2 8,1 4,6 2,4"/></svg>`;

// FIXED: Hover-based bounding detection to automatically ignore click-events on empty window space
window.addEventListener('mousemove', (e) => {
  const machine = document.getElementById('typewriter-machine');
  const paper = document.getElementById('paper');
  const modals = [
    document.getElementById('modal-add-plan'),
    document.getElementById('modal-completion'),
    document.getElementById('modal-abort')
  ];

  const isOverElement = (el) => {
    if (!el || el.classList.contains('hidden')) return false;
    const rect = el.getBoundingClientRect();
    return e.clientX >= rect.left && e.clientX <= rect.right &&
           e.clientY >= rect.top && e.clientY <= rect.bottom;
  };

  const overMachine = isOverElement(machine);
  const overPaper = isOverElement(paper);
  const overModal = modals.some(m => isOverElement(m));

  if (overMachine || overPaper || overModal) {
    window.retroAPI.setIgnoreMouseEvents(false);
  } else {
    window.retroAPI.setIgnoreMouseEvents(true, { forward: true });
  }
});

// Visual Key Bounce Animation
function animateKey(keyEl, label) {
  sounds.keyClickSound();
  keyEl.classList.add('pressed');

  const badge = document.createElement('div');
  badge.className = 'key-pop-badge';
  badge.textContent = label || keyEl.textContent || '␣';
  keyEl.appendChild(badge);

  setTimeout(() => keyEl.classList.remove('pressed'), 120);
  setTimeout(() => badge.remove(), 230);
}

document.querySelectorAll('.key').forEach(k => {
  k.addEventListener('click', () => {
    animateKey(k, k.textContent || '␣');
  });
});

// Stepped Print Animation
async function animateInitialPrint() {
  paperEl.classList.remove('hidden');
  paperEl.style.transition = 'none';

  const stages = [100, 60, 20, 0];
  for (let i = 0; i < stages.length; i++) {
    paperEl.style.transform = `translateY(${stages[i]}%)`;
    sounds.printSound();
    await new Promise(r => setTimeout(r, 80));
  }

  paperEl.style.transition = 'transform 0.2s steps(3, end)';
}

// Sparkle particle burst
function emitSparkles(targetElement) {
  const container = document.createElement('div');
  container.className = 'sparkle-container';

  const targets = [
    'translate(-14px, -12px)', 'translate(14px, -14px)',
    'translate(-16px, 8px)', 'translate(16px, 10px)',
    'translate(0px, -18px)', 'translate(0px, 16px)'
  ];

  for (let i = 0; i < 6; i++) {
    const s = document.createElement('div');
    s.className = 'pixel-sparkle';
    s.style.left = '6px';
    s.style.top = '6px';
    s.style.setProperty('--burst-target', targets[i]);
    container.appendChild(s);
  }

  targetElement.style.position = 'relative';
  targetElement.appendChild(container);
  setTimeout(() => container.remove(), 550);
}

// Confetti pieces
function triggerConfetti() {
  const container = document.getElementById('confetti-container');
  container.innerHTML = '';
  const colors = ['#C1443C', '#F5EDE0', '#222222', '#888888', '#FF8080', '#FFD700'];

  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.floor(Math.random() * 410)}px`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${1.2 + Math.random() * 0.8}s`;
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    container.appendChild(piece);
  }
  setTimeout(() => { container.innerHTML = ''; }, 2800);
}

// Parse Markdown with Section Headers support
function parseMarkdown(mdText) {
  const lines = mdText.split(/\r?\n/);
  let title = "MY PLAN";
  const sections = [];
  let currentSection = { title: null, tasks: [] };

  const h1Match = mdText.match(/^#\s+(.+)$/m);
  if (h1Match) title = h1Match[1].trim();

  const taskRegex = /^\s*-\s*\[([ xX])\]\s+(.*)$/;
  const h2Regex = /^##\s+(.+)$/;

  let idx = 1;
  lines.forEach(l => {
    const h2Match = l.match(h2Regex);
    if (h2Match) {
      if (currentSection.tasks.length > 0 || currentSection.title !== null) {
        sections.push(currentSection);
      }
      currentSection = { title: h2Match[1].trim(), tasks: [] };
      return;
    }

    const match = l.match(taskRegex);
    if (match) {
      currentSection.tasks.push({
        id: `tp_${Date.now()}_${idx++}`,
        text: match[2].trim(),
        done: match[1].toLowerCase() === 'x',
        at: match[1].toLowerCase() === 'x' ? new Date().toISOString() : null
      });
    }
  });

  if (currentSection.tasks.length > 0 || currentSection.title !== null) {
    sections.push(currentSection);
  }

  const totalTasks = sections.reduce((acc, s) => acc + s.tasks.length, 0);
  if (totalTasks === 0) return null;

  return { title, sections };
}

function rebuildMarkdown(plan) {
  let md = `# ${plan.title || "Custom Plan"}\n\n`;
  if (plan.sections && plan.sections.length > 0) {
    plan.sections.forEach(sec => {
      if (sec.title) md += `## ${sec.title}\n`;
      sec.tasks.forEach(t => {
        md += `- [${t.done ? 'x' : ' '}] ${t.text}\n`;
      });
      md += `\n`;
    });
  }
  return md.trim();
}

// Sync State across frames
function syncState(state) {
  appState = state;
  sounds.muted = !!state.muted;
  btnSoundToggle.textContent = state.muted ? '✕' : '♪';

  if (state.typewriterViewMode === 'list') {
    window.retroAPI.setTypewriterHeight(950);
    paperSlotMask.style.height = '600px';
  } else {
    window.retroAPI.setTypewriterHeight(720);
    paperSlotMask.style.height = '420px';
  }

  const isCustomActive = state.typewriterPlan?.active;

  if (isCustomActive) {
    renderCustomPlan();
  } else {
    renderDashboardPriorities();
  }

  paperEl.style.transform = 'translateY(0%)';
}

// Render Dashboard Priorities
function renderDashboardPriorities() {
  const items = appState.todayTopPriorities?.items || [];
  const total = items.filter(i => !i.hidden).length;
  const done = items.filter(i => !i.hidden && i.done).length;
  statusProgress.textContent = `${done}/${total} done`;

  if (total === 0) {
    paperEl.classList.add('hidden');
    idlePanel.classList.remove('hidden');
    return;
  }

  idlePanel.classList.add('hidden');
  paperEl.classList.remove('hidden');
  paperTitleEl.textContent = `··· ${appState.meta.title.toUpperCase()} ···`;
  paperBodyEl.innerHTML = '';
  allDoneBanner.classList.add('hidden');

  const allCompleted = items.every(i => i.done);

  if (appState.typewriterViewMode === 'list') {
    btnViewToggle.textContent = '●';
    items.forEach(i => {
      if (!i.hidden) paperBodyEl.appendChild(createRow(i, false, false));
    });
    if (allCompleted) allDoneBanner.classList.remove('hidden');
  } else {
    btnViewToggle.textContent = '≡';
    if (allCompleted) {
      allDoneBanner.classList.remove('hidden');
    } else {
      const nextTask = items.find(i => !i.done && !i.hidden);
      if (nextTask) {
        paperBodyEl.appendChild(createRow(nextTask, true, false));
      }
    }
  }
}

// Render Custom Plan (Supporting Sections, Done stamps, and Completion flow)
function renderCustomPlan() {
  const plan = appState.typewriterPlan;
  paperTitleEl.textContent = `··· ${plan.title.toUpperCase()} ···`;
  paperBodyEl.innerHTML = '';
  idlePanel.classList.add('hidden');
  paperEl.classList.remove('hidden');

  let total = 0;
  let done = 0;
  plan.sections.forEach(s => {
    s.tasks.forEach(t => {
      total++;
      if (t.done) done++;
    });
  });

  statusProgress.textContent = `${done}/${total} done`;

  const allCompleted = plan.sections.every(s => s.tasks.every(t => t.done));

  if (appState.typewriterViewMode === 'list') {
    btnViewToggle.textContent = '●';
    plan.sections.forEach(sec => {
      const allSecDone = sec.tasks.length > 0 && sec.tasks.every(t => t.done);
      if (sec.title) {
        const secHeader = document.createElement('div');
        secHeader.className = 'section-label-container';
        secHeader.innerHTML = `
          <div class="section-label-row">
            <span class="section-label text-pixel-xs">${sec.title}</span>
            ${allSecDone ? '<span class="done-stamp text-pixel-xs">done!</span>' : ''}
          </div>
        `;
        paperBodyEl.appendChild(secHeader);
      }
      sec.tasks.forEach(t => {
        paperBodyEl.appendChild(createRow(t, false, true));
      });
    });

    if (allCompleted) {
      allDoneBanner.classList.remove('hidden');
    } else {
      allDoneBanner.classList.add('hidden');
    }
  } else {
    // Focus mode
    btnViewToggle.textContent = '≡';
    allDoneBanner.classList.add('hidden');

    if (allCompleted) {
      allDoneBanner.classList.remove('hidden');
      triggerCompletionFlow();
      return;
    }

    // Find first incomplete task
    let targetSec = null;
    let targetTask = null;
    for (const sec of plan.sections) {
      for (const task of sec.tasks) {
        if (!task.done) {
          targetSec = sec;
          targetTask = task;
          break;
        }
      }
      if (targetTask) break;
    }

    if (targetTask) {
      if (targetSec && targetSec.title) {
        const secHeader = document.createElement('div');
        secHeader.className = 'section-label-container';
        secHeader.innerHTML = `
          <div class="section-label-row">
            <span class="section-label text-pixel-xs">${targetSec.title}</span>
          </div>
        `;
        paperBodyEl.appendChild(secHeader);
      }
      paperBodyEl.appendChild(createRow(targetTask, true, true));
    }
  }

  if (allCompleted) {
    triggerCompletionFlow();
  }
}

function createRow(item, isFocusMode, isCustomPlan) {
  const row = document.createElement('div');
  row.className = 'task-row no-drag';

  const chk = document.createElement('div');
  chk.className = `task-checkbox ${item.done ? 'checked' : ''}`;
  chk.innerHTML = CHECK_SVG;

  const txt = document.createElement('span');
  txt.className = `task-text text-pixel-xs ${item.done ? 'done' : ''}`;
  txt.textContent = item.text;

  row.appendChild(chk);
  row.appendChild(txt);

  row.addEventListener('click', async () => {
    const targetDone = !item.done;
    item.done = targetDone;

    if (targetDone) {
      sounds.checkSound();
      chk.classList.add('checked');
      txt.classList.add('done');
      emitSparkles(chk);
    } else {
      sounds.uncheckSound();
      chk.classList.remove('checked');
      txt.classList.remove('done');
    }

    await window.retroAPI.saveState(appState);

    // FIXED: Video-accurate brisk focus transitions 
    if (isFocusMode && targetDone) {
      setTimeout(() => {
        row.style.transition = 'opacity 0.15s steps(2)';
        row.style.opacity = '0';
        setTimeout(() => {
          sounds.printSound();
          syncState(appState);
        }, 150);
      }, 350); 
    } else {
      syncState(appState);
    }
  });

  return row;
}

// Completion Session Note prompt
function triggerCompletionFlow() {
  if (hasCelebrated) return;
  hasCelebrated = true;

  sounds.completionSound();
  triggerConfetti();

  setTimeout(() => {
    sessionNoteInput.value = '';
    modalCompletion.classList.remove('hidden');
    sessionNoteInput.focus();
  }, 1600);
}

btnCompleteSave.addEventListener('click', async () => {
  const note = sessionNoteInput.value.trim();
  if (note && appState.typewriterPlan) {
    if (!appState.typewriterPlan.history) appState.typewriterPlan.history = [];
    appState.typewriterPlan.history.push({
      date: new Date().toISOString(),
      note: note,
      planTitle: appState.typewriterPlan.title
    });
  }

  // Deactivate custom plan and slide back to standard priorities mode
  appState.typewriterPlan.active = false;
  hasCelebrated = false;
  modalCompletion.classList.add('hidden');
  sounds.printSound();
  await window.retroAPI.saveState(appState);
});

btnCompleteSkip.addEventListener('click', async () => {
  appState.typewriterPlan.active = false;
  hasCelebrated = false;
  modalCompletion.classList.add('hidden');
  sounds.printSound();
  await window.retroAPI.saveState(appState);
});

// Abort workflow trigger (Control + C)
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'c' && !e.metaKey) {
    if (document.activeElement === sessionNoteInput || document.activeElement === planInputTextarea) return;
    if (appState && appState.typewriterPlan?.active) {
      modalAbort.classList.remove('hidden');
    }
  }
});

btnAbortLog.addEventListener('click', async () => {
  if (appState.typewriterPlan) {
    if (!appState.typewriterPlan.history) appState.typewriterPlan.history = [];
    appState.typewriterPlan.history.push({
      date: new Date().toISOString(),
      note: "Aborted - Progress Saved",
      planTitle: appState.typewriterPlan.title
    });
  }
  appState.typewriterPlan.active = false;
  modalAbort.classList.add('hidden');
  sounds.printSound();
  await window.retroAPI.saveState(appState);
});

btnAbortDiscard.addEventListener('click', async () => {
  appState.typewriterPlan = {
    active: false,
    title: "Custom Plan",
    sections: [],
    history: appState.typewriterPlan?.history || []
  };
  modalAbort.classList.add('hidden');
  sounds.printSound();
  await window.retroAPI.saveState(appState);
});

btnAbortCancel.addEventListener('click', () => {
  modalAbort.classList.add('hidden');
});

// View and sound toggles
btnViewToggle.addEventListener('click', async () => {
  if (!appState) return;
  const nextMode = appState.typewriterViewMode === 'focus' ? 'list' : 'focus';
  appState.typewriterViewMode = nextMode;
  await window.retroAPI.saveState(appState);
});

btnSoundToggle.addEventListener('click', async () => {
  if (!appState) return;
  appState.muted = !appState.muted;
  await window.retroAPI.saveState(appState);
});

// Clipboard paste custom plan support
window.addEventListener('paste', async (e) => {
  if (document.activeElement === sessionNoteInput || document.activeElement === planInputTextarea) return;

  const text = e.clipboardData.getData('text');
  if (!text) return;

  const parsed = parseMarkdown(text);
  if (parsed && appState) {
    appState.typewriterPlan = {
      active: true,
      title: parsed.title,
      sections: parsed.sections,
      history: appState.typewriterPlan?.history || []
    };
    hasCelebrated = false;
    sounds.printSound();
    await window.retroAPI.saveState(appState);
    await animateInitialPrint();
  }
});

// Drag and drop markdown plans file support
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  idlePanel.classList.add('drag-over');
});

window.addEventListener('dragleave', () => {
  idlePanel.classList.remove('drag-over');
});

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  idlePanel.classList.remove('drag-over');

  if (e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    if (file.name.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const text = event.target.result;
        const parsed = parseMarkdown(text);
        if (parsed && appState) {
          appState.typewriterPlan = {
            active: true,
            title: parsed.title,
            sections: parsed.sections,
            history: appState.typewriterPlan?.history || []
          };
          hasCelebrated = false;
          sounds.printSound();
          await window.retroAPI.saveState(appState);
          await animateInitialPrint();
        }
      };
      reader.readAsText(file);
    }
  }
});

btnPlus.addEventListener('click', () => {
  if (!appState) return;
  const plan = appState.typewriterPlan;
  planInputTextarea.value = rebuildMarkdown(plan);
  modalAddPlan.classList.remove('hidden');
  planInputTextarea.focus();
});

btnPlanLoad.addEventListener('click', async () => {
  const parsed = parseMarkdown(planInputTextarea.value);
  if (parsed && appState) {
    appState.typewriterPlan = {
      active: true,
      title: parsed.title,
      sections: parsed.sections,
      history: appState.typewriterPlan?.history || []
    };
    hasCelebrated = false;
    modalAddPlan.classList.add('hidden');
    sounds.printSound();
    await window.retroAPI.saveState(appState);
    await animateInitialPrint();
  }
});

btnPlanCancel.addEventListener('click', () => {
  modalAddPlan.classList.add('hidden');
});

// Keyboard mapping
window.addEventListener('keydown', (e) => {
  if (document.activeElement === planInputTextarea || document.activeElement === sessionNoteInput) return;
  const keyChar = e.key.toUpperCase();
  const allKeys = document.querySelectorAll('.key');

  if (e.code === 'Space') {
    const spaceKey = document.querySelector('.key-space');
    if (spaceKey) animateKey(spaceKey, '␣');
  } else {
    for (const k of allKeys) {
      if (k.textContent.trim() === keyChar) {
        animateKey(k, keyChar);
        break;
      }
    }
  }
});

// Bootstrap
async function init() {
  const res = await window.retroAPI.getState();
  if (res) {
    syncState(res);
  }
  window.retroAPI.onStateUpdated((freshState) => {
    syncState(freshState);
  });
}

init();