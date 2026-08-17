// =========================
// CodeHS Typer - popup.js
// =========================
// This file does two main things:
//
// 1) Popup UI logic (in the extension window)
//    - Reads what you type into the big textarea (the code).
//    - Reads speed (fast / normal / slow).
//    - Reads "lines per run" and "run wait seconds".
//    - Saves these values into chrome.storage so they stay for next time.
//    - When you click "Start typing", it finds the active CodeHS tab and
//      injects the typing function into that page.
//
// 2) Page typing logic (typeLikeHumanInPage)
//    - Runs INSIDE the CodeHS page, not in the popup.
//    - Finds the Ace editor (the code editor on CodeHS).
//    - Gets the current text and cursor position.
//    - Slowly "types" your code by rebuilding the text on every step.
//    - Optionally clicks the "Run" button every N lines.
//    - Uses flags (window.__codehsTyperRunning, __codehsTyperStop) so only
//      one typer runs at a time and you can stop it safely.

document.addEventListener("DOMContentLoaded", () => {
  const codeEl = document.getElementById("code");
  const speedEl = document.getElementById("speed");
  const linesEl = document.getElementById("linesPerRun");
  const runWaitEl = document.getElementById("runWaitSec");
  const statusEl = document.getElementById("status");
  const startBtn = document.getElementById("start");
  const runWaitRow = document.getElementById("runWaitRow");
  const autoRunBlock = document.getElementById("autoRunBlock");
  const showProgressEl = document.getElementById("showProgress");
  const pauseBtn = document.getElementById("pauseBtn");
  const resetBtn = document.getElementById("resetBtn");


let runWatchTimer = null;

function setDoneUI() {
  startBtn.textContent = "Done ✅";
  startBtn.classList.remove("stop-mode");
  startBtn.classList.add("start-mode");
  startBtn.disabled = false; // keep clickable if you want

  if (pauseBtn) {
    pauseBtn.disabled = true;
    pauseBtn.textContent = "Pause";
  }

  // optional: show message
  if (statusEl) statusEl.textContent = "Finished typing.";
}

function stopWatchingRunState() {
  if (runWatchTimer) {
    clearInterval(runWatchTimer);
    runWatchTimer = null;
  }
}

function startWatchingRunState(tabId) {
  stopWatchingRunState();

  runWatchTimer = setInterval(async () => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => ({
          running: !!window.__codehsTyperRunning,
          completed: !!window.__codehsTyperState?.completed,
        }),
      });

      const state = results?.[0]?.result;
      if (!state) return;

      // if it stopped (either finished or was paused/stopped)
      if (!state.running) {
        stopWatchingRunState();

        if (state.completed) {
          setDoneUI();
        } else {
          // stopped early -> go back to normal Start state
          setButtonRunning(false);
          if (pauseBtn) pauseBtn.disabled = true;
          if (statusEl) statusEl.textContent = "";
        }
      }
    } catch {
      // tab closed / permissions / etc.
      stopWatchingRunState();
      setButtonRunning(false);
      if (pauseBtn) pauseBtn.disabled = true;
    }
  }, 500); // checks twice per second
}



  // --- helper: Start / Stop button label ---
 function setButtonRunning(isRunning) {
  startBtn.textContent = isRunning ? "Stop typing" : "Start typing";
  startBtn.classList.toggle("stop-mode", isRunning);
  startBtn.classList.toggle("start-mode", !isRunning);
}

async function getActiveCodeHSTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("codehs.com")) return null;
  return tab;
}

  // --- helper: show/hide "Run wait" row based on Auto-run setting ---
function updateRunWaitVisibility() {
  const tipBox = document.getElementById("tipBox");
  const speed = speedEl.value;
  let v = parseInt(linesEl.value, 10);
  if (!Number.isFinite(v) || v < 0) v = 0;
  linesEl.value = v;

  if (speed === "auto") {
    // hide auto-run controls
    if (autoRunBlock) autoRunBlock.style.display = "none";
    if (runWaitRow)   runWaitRow.style.display = "none";

    // tip text for Auto mode
    if (tipBox) {
      tipBox.innerHTML =
        '<b>Tips:</b> Auto mode types like a human and manages ' +
        '"Run" clicks automatically. Auto-run settings are disabled.';
    }
    return;
  }

  // show auto-run controls for Slow / Normal / Fast
  if (autoRunBlock) autoRunBlock.style.display = "";
  if (v <= 0) {
    if (runWaitRow) runWaitRow.style.display = "none";
  } else {
    if (runWaitRow) runWaitRow.style.display = "flex";
  }

  // normal tip text
  if (tipBox) {
    tipBox.innerHTML =
      '<b>Tips:</b> Set <b>0</b> lines to disable auto-run. ' +
      'Run wait controls how long to pause after clicking <b>Run</b> ' +
      'before typing continues.';
  }
}

async function updateButtonFromPageState() {
  const tab = await getActiveCodeHSTab();

  if (!tab) {
    setButtonRunning(false);
    if (pauseBtn) pauseBtn.disabled = true;
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => ({
        running: !!window.__codehsTyperRunning,
        completed: !!window.__codehsTyperState?.completed,
      }),
    });

    const state = results?.[0]?.result || { running: false, completed: false };

    if (!state.running && state.completed) {
      setDoneUI();
      return;
    }

    setButtonRunning(state.running);

    if (pauseBtn) {
      pauseBtn.disabled = !state.running;
      pauseBtn.textContent = "Pause";
    }
  } catch {
    setButtonRunning(false);
    if (pauseBtn) pauseBtn.disabled = true;
  }
}

if (pauseBtn) {
  pauseBtn.disabled = true; // default

pauseBtn.addEventListener("click", async () => {
  stopWatchingRunState(); 

  const tab = await getActiveCodeHSTab();

    if (!tab) return;

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      if (window.__codehsTyperStop) window.__codehsTyperStop();
    },
    world: "MAIN",
  });

    // Pause means stop the current run but keep resume state
    setButtonRunning(false);
    pauseBtn.disabled = true;
    pauseBtn.textContent = "Pause";
    if (statusEl) statusEl.textContent = "";
  });
}

if (resetBtn) {
  resetBtn.addEventListener("click", async () => {
  stopWatchingRunState(); 

    // clear textbox
    codeEl.value = "";

    // reset UI values
    speedEl.value = "normal";
    linesEl.value = 0;
    runWaitEl.value = 20;
    if (showProgressEl) showProgressEl.checked = false;

    // save defaults in ONE call
    chrome.storage.local.set({
      savedCode: "",
      savedSpeed: "normal",
      savedLinesPerRun: 0,
      savedRunWaitSec: 20,
      savedShowProgress: false,
    });

    updateRunWaitVisibility();

    // reset UI buttons
    setButtonRunning(false);
    if (pauseBtn) {
      pauseBtn.disabled = true;
      pauseBtn.textContent = "Pause";
    }
    if (statusEl) statusEl.textContent = "";

    // clear resume state on CodeHS page
    const tab = await getActiveCodeHSTab();
    if (!tab) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (window.__codehsTyperStop) window.__codehsTyperStop();
        window.__codehsTyperState = null; // wipe resume data
        window.__codehsTyperRunning = false;
        window.__codehsTyperStopRequested = false;
      },
      world: "MAIN",
    });
  });
}

  // sync button with current page state when popup opens
  updateButtonFromPageState();

// ---------- restore saved values ----------
chrome.storage.local.get(
  ["savedCode", "savedSpeed", "savedLinesPerRun", "savedRunWaitSec", "savedShowProgress"],
  (res) => {
    if (typeof res.savedCode === "string") codeEl.value = res.savedCode;
    if (typeof res.savedSpeed === "string") speedEl.value = res.savedSpeed;
    if (typeof res.savedLinesPerRun === "number") linesEl.value = res.savedLinesPerRun;
    if (typeof res.savedRunWaitSec === "number") runWaitEl.value = res.savedRunWaitSec;

    if (typeof res.savedShowProgress === "boolean" && showProgressEl) {
      showProgressEl.checked = res.savedShowProgress;
    }

    updateRunWaitVisibility();
  }
);

  // ---------- save on change ----------
  codeEl.addEventListener("input", () => {
    chrome.storage.local.set({ savedCode: codeEl.value });
  });


speedEl.addEventListener("change", () => {
  chrome.storage.local.set({ savedSpeed: speedEl.value });
  updateRunWaitVisibility();
});

  linesEl.addEventListener("change", () => {
    let v = parseInt(linesEl.value, 10);
    if (!Number.isFinite(v) || v < 0) v = 0;
    linesEl.value = v;
    chrome.storage.local.set({ savedLinesPerRun: v });
    updateRunWaitVisibility();
  });

  runWaitEl.addEventListener("change", () => {
    let v = parseInt(runWaitEl.value, 10);
    if (!Number.isFinite(v) || v < 1) v = 1;
    runWaitEl.value = v;
    chrome.storage.local.set({ savedRunWaitSec: v });
  });

if (showProgressEl) {
  showProgressEl.addEventListener("change", () => {
    chrome.storage.local.set({ savedShowProgress: !!showProgressEl.checked });
  });
}

  // helper: hook up + / - steppers for number inputs
  function setupNumberStepper(id) {
    const buttons = document.querySelectorAll(`.num-btn[data-target="${id}"]`);
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const delta = parseInt(btn.dataset.delta, 10) || 0;
        const input = document.getElementById(id);
        let v = parseInt(input.value, 10);
        if (!Number.isFinite(v)) v = 0;
        v += delta;

        const min = input.min !== "" ? parseInt(input.min, 10) : undefined;
        if (min !== undefined && v < min) v = min;

        input.value = v;

        // fire change so your existing listeners run
        const ev = new Event("change", { bubbles: true });
        input.dispatchEvent(ev);
      });
    });
  }

  setupNumberStepper("linesPerRun");
  setupNumberStepper("runWaitSec");


// ---------- start/stop button ----------
startBtn.addEventListener("click", async () => {
  const code = codeEl.value;
  const speed = speedEl.value;
  const linesPerRunRaw = linesEl.value;
  const runWaitRaw = runWaitEl.value;
  const showProgress = showProgressEl ? showProgressEl.checked : false;

  const tab = await getActiveCodeHSTab();
  if (!tab) {
    statusEl.textContent = "Open a CodeHS tab first.";
    return;
  }

  // read running state from the page
  let state = { running: false, completed: false };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => ({
        running: !!window.__codehsTyperRunning,
        completed: !!window.__codehsTyperState?.completed,
      }),
    });
    state = results?.[0]?.result || state;
  } catch {}

  // STOP (if currently running)
  if (state.running) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => {
        if (window.__codehsTyperStop) window.__codehsTyperStop();
      },
    });

    stopWatchingRunState();
    statusEl.textContent = "";
    setButtonRunning(false);

    if (pauseBtn) {
      pauseBtn.disabled = true;
      pauseBtn.textContent = "Pause";
    }
    return;
  }

  // START
  let linesPerRun = parseInt(linesPerRunRaw, 10);
  if (!Number.isFinite(linesPerRun) || linesPerRun < 0) linesPerRun = 0;

  let runWaitSec = parseInt(runWaitRaw, 10);
  if (!Number.isFinite(runWaitSec) || runWaitSec < 1) runWaitSec = 20;

  if (speed === "auto") linesPerRun = 0;

  if (!code.trim()) {
    statusEl.textContent = "Paste some code first.";
    return;
  }

  statusEl.textContent = "Starting...";

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      world: "MAIN",
      func: typeLikeHumanInPage,
      args: [code, speed, linesPerRun, runWaitSec, showProgress],
    },
    () => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = "Error: " + chrome.runtime.lastError.message;
        setButtonRunning(false);
        stopWatchingRunState();
        if (pauseBtn) pauseBtn.disabled = true;
        return;
      }

      setButtonRunning(true);
      statusEl.textContent = "";

      if (pauseBtn) {
        pauseBtn.disabled = false;
        pauseBtn.textContent = "Pause";
      }

      startWatchingRunState(tab.id);
    }
  );
});
});

// ----------------------------------------------------------
// typeLikeHumanInPage(fullText, speedMode, linesPerRunArg, runWaitSecArg)
// ----------------------------------------------------------
// Runs inside the CodeHS page (MAIN world).
//
// What it does:
// - Finds the Ace editor used by CodeHS.
// - Makes sure another typer is not already running.
// - Reads options from the popup:
//     fullText      → the code you pasted in the popup
//     speedMode     → "fast", "normal", or "slow"
//     linesPerRun   → how many NEW lines to type before auto-clicking Run
//     runWaitSec    → how many seconds to wait after clicking Run
// - Normalizes line endings so "\r\n" and "\n" behave the same.
// - Converts the code string into an array of characters and types them
//   one by one with a delay (this is the "human typing" effect).
// - Uses a STOP flag so the popup can stop the typer in the middle.
// - Keeps track of how many new lines were typed to trigger auto-run.
// - When finished (or stopped), it clears the running flags.
//
// IMPORTANT:
// - This function is injected into the CodeHS tab by chrome.scripting.
//   It does NOT run in the popup, it runs directly on the page.

// ----------------------------------------------------------
// typeLikeHumanInPage(fullText, speedMode, linesPerRunArg, runWaitSecArg)
// ----------------------------------------------------------
function typeLikeHumanInPage(fullText, speedMode, linesPerRunArg, runWaitSecArg, showProgressArg) {
  const aceDiv = document.querySelector(".ace_editor");
  if (!aceDiv || !window.ace || typeof window.ace.edit !== "function") {
    return;
  }

  // Prevent multiple runs
  if (window.__codehsTyperRunning) {
    alert("CodeHS Human Typer is already running on this page.");
    return;
  }

  window.__codehsTyperRunning = true;
  window.__codehsTyperStopRequested = false;
  window.__codehsTyperStop = () => {
    window.__codehsTyperStopRequested = true;
  };

  // Parse options
  let LINES_PER_RUN = parseInt(linesPerRunArg, 10);
  if (!Number.isFinite(LINES_PER_RUN) || LINES_PER_RUN < 0) {
    LINES_PER_RUN = 0;
  }

  let RUN_WAIT_SEC = parseInt(runWaitSecArg, 10);
  if (!Number.isFinite(RUN_WAIT_SEC) || RUN_WAIT_SEC < 1) {
    RUN_WAIT_SEC = 20;
  }

  // speed → base ms/char (used for non-auto modes)
  let CHAR_DELAY_MS;
  if (speedMode === "fast") CHAR_DELAY_MS = 30;
  else if (speedMode === "slow") CHAR_DELAY_MS = 150;
  else CHAR_DELAY_MS = 80; // normal base (NOT used in auto)

  const LINE_GAP_MS = 120;
  const normalizedText = fullText.replace(/\r\n/g, "\n");
  const chars = Array.from(normalizedText);
  const USE_MISTAKES = speedMode === "auto";
  const SHOW_PROGRESS = Boolean(showProgressArg);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function sleepWithStop(totalMs) {
    const step = 80;
    let elapsed = 0;
    while (elapsed < totalMs && !window.__codehsTyperStopRequested) {
      const chunk = Math.min(step, totalMs - elapsed);
      await sleep(chunk);
      elapsed += chunk;
    }
  }

  function findRunButton() {
    return (
      Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent.trim().toLowerCase() === "run"
      ) || null
    );
  }

  // ---- helpers for "human mistakes" + randomness ----
  function isWhitespaceChar(c) {
    return c === " " || c === "\n" || c === "\t" || c === "\r";
  }

  function randomMistakeChar() {
    const letters = "asdfghjklqwertyuiopzxcvbnm";
    const idx = Math.floor(Math.random() * letters.length);
    return letters[idx];
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async function run() {
    const editor = window.ace.edit(aceDiv);
    const session = editor.getSession();
    const doc = session.getDocument();
    const runButton = findRunButton();

  const startTime = Date.now();
  function formatTime(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
  }

    let originalText = editor.getValue();
    const cursorPos = editor.getCursorPosition();
    let cursorIndex = doc.positionToIndex(cursorPos);

    // V3 CHANGE: resume support
    let typed = "";
    let linesTyped = 0;
    let startIndex = 0;

    const stateKey = normalizedText; // resume only if the pasted code matches exactly
    const st = window.__codehsTyperState;


    if (
      st &&
      st.key === stateKey &&
      typeof st.typedLen === "number" &&
      st.typedLen > 0 &&
      st.typedLen < normalizedText.length &&
      !st.completed
    ) {
      startIndex = st.typedLen;
      typed = normalizedText.slice(0, startIndex);
      linesTyped = typeof st.linesTyped === "number" ? st.linesTyped : 0;

      // restore original insertion anchor so before/after slices stay identical
      if (typeof st.originalText === "string") originalText = st.originalText;
      if (Number.isFinite(st.cursorIndex)) cursorIndex = st.cursorIndex;
    } else {
      window.__codehsTyperState = {
        key: stateKey,
        typedLen: 0,
        linesTyped: 0,
        completed: false,
        originalText,
        cursorIndex
      };
    }

    const totalLines = normalizedText.split("\n").length;
    const autoMode = speedMode === "auto";
    const autoRunEnabled = autoMode && !!runButton;




    const totalChars = chars.length;

    // --- create a bigger progress bar overlay on the editor (top-right) ---
// --- create a bigger progress bar overlay on the editor (top-right) ---
let progressContainer = null;
let progressInner = null;
let progressLabel = null;

if (SHOW_PROGRESS) {
  progressContainer = document.getElementById("__codehsTyperProgress");

  if (!progressContainer) {
    progressContainer = document.createElement("div");
    progressContainer.id = "__codehsTyperProgress";

    // position in the Ace editor
    progressContainer.style.position = "absolute";
    progressContainer.style.top = "6px";
    progressContainer.style.right = "10px";

    // size & look
    progressContainer.style.width = "220px";
    progressContainer.style.height = "26px";
    progressContainer.style.borderRadius = "999px";
    progressContainer.style.background = "rgba(15, 23, 42, 0.95)";
    progressContainer.style.border = "1px solid rgba(148, 163, 184, 0.9)";
    progressContainer.style.boxShadow = "0 6px 18px rgba(0,0,0,0.5)";
    progressContainer.style.display = "flex";
    progressContainer.style.alignItems = "center";
    progressContainer.style.padding = "4px 8px";
    progressContainer.style.fontSize = "11px";
    progressContainer.style.color = "#e5e7eb";
    progressContainer.style.zIndex = "9999";
    progressContainer.style.pointerEvents = "none";

    // inner bar
    progressInner = document.createElement("div");
    progressInner.style.height = "10px";
    progressInner.style.width = "0%";
    progressInner.style.borderRadius = "999px";
    progressInner.style.background = "#3b82f6";
    progressInner.style.transition = "width 0.12s linear";

    // label (on the right)
    progressLabel = document.createElement("span");
    progressLabel.style.marginLeft = "8px";
    progressLabel.style.minWidth = "40px";
    progressLabel.style.textAlign = "right";
    progressLabel.textContent = "0%";

    const barWrapper = document.createElement("div");
    barWrapper.style.flex = "1";
    barWrapper.style.height = "10px";
    barWrapper.style.borderRadius = "999px";
    barWrapper.style.background = "rgba(15, 23, 42, 0.7)";
    barWrapper.style.overflow = "hidden";
    barWrapper.appendChild(progressInner);

    progressContainer.appendChild(barWrapper);
    progressContainer.appendChild(progressLabel);

    // make sure aceDiv can host an absolutely-positioned child
    if (getComputedStyle(aceDiv).position === "static") {
      aceDiv.style.position = "relative";
    }
    aceDiv.appendChild(progressContainer);
  } else {
    // if it already exists for some reason, re-use its children
    const barWrapper = progressContainer.firstElementChild;
    progressInner = barWrapper ? barWrapper.firstElementChild : null;
    progressLabel = progressContainer.lastElementChild;
  }
}







    // ---- auto-mode chunked Run behaviour ----
    let baseChunk = 0;
    if (autoRunEnabled) {
      if (totalLines <= 10) {
        baseChunk = 0; // probably only run at end
      } else if (totalLines <= 25) {
        baseChunk = 7; // ~6–8
      } else if (totalLines <= 60) {
        baseChunk = 10; // ~8–12
      } else {
        baseChunk = 13; // ~12–15
      }
    }

    function nextChunkTarget(fromLine) {
      if (!baseChunk) return Infinity;
      const min = Math.max(1, baseChunk - 2);
      const max = baseChunk + 2;
      return fromLine + randInt(min, max);
    }

    let nextRunAtLine = autoRunEnabled ? nextChunkTarget(0) : Infinity;

    function computeAutoRunWaitMs() {
      let minWait, maxWait;
      if (totalLines <= 15) {
        minWait = 7000;  // 7s
        maxWait = 9000;  // 9s
      } else if (totalLines <= 40) {
        minWait = 10000; // 10s
        maxWait = 13000; // 13s
      } else {
        minWait = 13000; // 13s
        maxWait = 16000; // 16s
      }
      return randInt(minWait, maxWait);
    }

    // 🔹 Human mistake settings (auto only – more frequent + slower)
    const MISTAKE_EVERY_N_WORDS = 1;       // every 2nd word eligible
    const MISTAKE_CHANCE = 0.9;           // 85% of eligible words get a mistake
    const MISTAKE_EXTRA_DELAY_MS = 350;    // bigger pause around error
    let wordIndex = 0;
    let inWord = false;
    let lettersInCurrentWord = 0;
    let doMistakeThisWord = false;
    let mistakeDoneThisWord = false;

    editor.focus();

    try {
      for (let i = startIndex; i < chars.length; i++) { 
        if (window.__codehsTyperStopRequested) break;

        const ch = chars[i];
        typed += ch;

        // count lines for auto-run logic
        if (ch === "\n") {
          linesTyped++;
        }

	if (window.__codehsTyperState && (i % 5 === 0)) {
	  window.__codehsTyperState.typedLen = i + 1;
	  window.__codehsTyperState.linesTyped = linesTyped;
	  window.__codehsTyperState.completed = false;
	}

        // update progress bar
        if (SHOW_PROGRESS && (progressInner || progressLabel)) {
          const pct = Math.round(((i + 1) / totalChars) * 100);
          if (progressInner) {
            progressInner.style.width = pct + "%"; 
          }
          if (progressLabel) {
	  const elapsed = Date.now() - startTime;
	  const done = i + 1;
	  const total = totalChars;

	  const msPerChar = done > 0 ? elapsed / done : 0;
	  const remainingMs = Math.round((total - done) * msPerChar);

	  // show: percent + remaining time
	  progressLabel.textContent = `${pct}% • ${formatTime(remainingMs)}`;
	 }
        }

        // character classification
        const isWhitespace = isWhitespaceChar(ch);
        const isQuote = ch === '"' || ch === "'" || ch === "`";
        const isBackslash = ch === "\\";
        const isBracket = "[](){}".includes(ch);
        const isSymbol = /[+\-*/=%<>!&|^]/.test(ch);
        const isTrickyForMistake = isQuote || isBackslash || isBracket || isSymbol;

        // ---- track "words" for auto mistakes ----
        if (USE_MISTAKES) {
          if (isWhitespace) {
            if (inWord) {
              inWord = false;
              lettersInCurrentWord = 0;
              doMistakeThisWord = false;
              mistakeDoneThisWord = false;
            }
          } else {
            if (!inWord) {
              inWord = true;
              wordIndex++;
              lettersInCurrentWord = 0;
              // every ~2nd word is *eligible* for a mistake
              doMistakeThisWord =
                MISTAKE_EVERY_N_WORDS > 0 &&
                wordIndex % MISTAKE_EVERY_N_WORDS === 0 &&
                Math.random() < MISTAKE_CHANCE;
              mistakeDoneThisWord = false;
            }
            lettersInCurrentWord++;
          }
        }

        // 🔹 Build new full text (SAME core logic so code is exact):
        const before = originalText.slice(0, cursorIndex);
        const after = originalText.slice(cursorIndex);
        let newText = before + typed + after;

        editor.setValue(newText, -1); // put cursor at end (visual only)

        // ---- simulate typo + backspace on some words (auto only) ----
        if (
          USE_MISTAKES &&
          doMistakeThisWord &&
          !mistakeDoneThisWord &&
          !isWhitespace &&
          lettersInCurrentWord >= 2 &&   // don’t glitch on first letter
          isTrickyForMistake &&         // mostly on tricky chars
          !window.__codehsTyperStopRequested
        ) {
          mistakeDoneThisWord = true;

          // add one wrong extra character
          const wrongChar = randomMistakeChar();
          typed += wrongChar;
          newText = before + typed + after;
          editor.setValue(newText, -1);
          // pause on the wrong char
          await sleepWithStop(MISTAKE_EXTRA_DELAY_MS + randInt(80, 200));

          // "backspace" the wrong character
          typed = typed.slice(0, -1);
          newText = before + typed + after;
          editor.setValue(newText, -1);
          // small pause after fixing it
          await sleepWithStop(MISTAKE_EXTRA_DELAY_MS + randInt(120, 260));
        }

        // 🔹 timing + auto-run behaviour
        if (!autoMode) {
          // ==== ORIGINAL behaviour for slow/normal/fast ====
          if (ch === "\n") {
            if (
              LINES_PER_RUN > 0 &&
              runButton &&
              linesTyped > 0 &&
              linesTyped % LINES_PER_RUN === 0 &&
              !window.__codehsTyperStopRequested
            ) {
              runButton.click();
              await sleepWithStop(RUN_WAIT_SEC * 1000);
            }

            await sleepWithStop(CHAR_DELAY_MS + LINE_GAP_MS);
          } else {
            await sleepWithStop(CHAR_DELAY_MS);
          }
        } else {
          // ==== AUTO (human-like, slower) MODE ====

          // human-like Run: every chunk of lines, but only at a "nice" break
          if (
            autoRunEnabled &&
            ch === "\n" &&
            linesTyped >= nextRunAtLine &&
            !window.__codehsTyperStopRequested
          ) {
            const textUpToNow = newText.slice(0, before.length + typed.length);
            const parts = textUpToNow.split("\n");
            let lastCompleteLine = "";
            if (parts.length >= 2) {
              lastCompleteLine = parts[parts.length - 2];
            }
            const trimmed = lastCompleteLine.trim();
            const isGoodLine =
              trimmed.length > 0 &&
              (trimmed.endsWith(":") ||
                trimmed.length > 20 ||
                linesTyped >= (totalLines - 1));

            if (isGoodLine) {
              runButton.click();
              await sleepWithStop(computeAutoRunWaitMs());
              nextRunAtLine = nextChunkTarget(linesTyped);
            } else {
              // not a good breakpoint, delay the target a bit
              nextRunAtLine = linesTyped + 2;
            }
          }

          // 🔸 slower, more "thinking" delays
          let delayMs;
	if (isWhitespace && ch !== "\n") {
	  delayMs = randInt(180, 280);
	} else if (isQuote || isBackslash) {
	  delayMs = randInt(260, 380);
	} else if (isBracket || isSymbol) {
	  delayMs = randInt(220, 340);
	} else {
	  delayMs = randInt(200, 300);
	}

          if (ch === "\n") {
            // big pause at end of line
            delayMs += randInt(250, 450);
          }

          // occasional extra "thinking" pause every ~18–25 chars
	if (
	  i > 0 &&
	  i % randInt(18, 25) === 0 &&
	  Math.random() < 0.7
	) {
	  delayMs += randInt(400, 900);
	}

          await sleepWithStop(delayMs);
        }
      }

	if (
	  autoRunEnabled &&
	  !window.__codehsTyperStopRequested &&
	  linesTyped >= (totalLines - 1)
	) {
	  runButton.click();
	  await sleepWithStop(computeAutoRunWaitMs());
	}


} finally {
  // ensure the last state is saved correctly
  if (window.__codehsTyperState) {
    window.__codehsTyperState.typedLen = typed.length; 
    window.__codehsTyperState.linesTyped = linesTyped;

    // only mark completed if we actually finished typing ALL chars
    window.__codehsTyperState.completed =
      !window.__codehsTyperStopRequested && typed.length >= chars.length;
  }

  window.__codehsTyperRunning = false;
  window.__codehsTyperStopRequested = false;

  // remove progress bar when done
  if (SHOW_PROGRESS) {
    const existing = document.getElementById("__codehsTyperProgress");
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }
}

     } 

  run();
}
