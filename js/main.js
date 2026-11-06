import { BambooScene } from './scene.js?v=20261106-2';
import { BambooPhysics, SING_RPM, MAX_RPM } from './physics.js?v=20261106-2';
import { CicadaAudio, estimateFundamental } from './audio.js?v=20261106-2';
import { HandGestureController } from './gestures.js?v=20261106-2';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TAU = Math.PI * 2;
const RECORD_KEY = 'bamboo-cicada-records-v1';
const MAX_FPS = 60;
const IDLE_FPS = 30;
const SOFTWARE_FPS = 24;
const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 4;
const MAX_FRAME_DT = 0.1;

let renderLoopActive = false;
let animationHandle = 0;
let lastLoopAt = 0;
let frameBudgetMs = 0;
let simAccumulator = 0;
let targetFps = IDLE_FPS;
let lowPower = false;
let lowPerfSeconds = 0;
let lastInteractionAt = 0;
let qualityMode = 'performance';
let softwareGPU = false;

const dom = {
  app: $('app'),
  canvas: $('scene-canvas'),
  intro: $('intro'),
  loading: $('loading-screen'),
  start: $('btn-start'),
  topbar: $('topbar'),
  challengeCard: $('challenge-card'),
  challengeButton: $('btn-challenge'),
  challengeReset: $('btn-reset'),
  challengeState: $('challenge-state'),
  challengeProgress: $('challenge-progress'),
  liveDot: $('live-dot'),
  singTime: $('sing-time'),
  score: $('score'),
  combo: $('combo'),
  bestTime: $('best-time'),
  rpm: $('rpm'),
  gaugeValue: $('gauge-value'),
  gaugeNeedle: $('gauge-needle'),
  gaugeTicks: $('gauge-ticks'),
  gaugeMarker: $('gauge-marker'),
  singState: $('sing-state'),
  freq: $('freq'),
  level: $('level'),
  audioState: $('audio-state'),
  rubHint: $('rub-hint'),
  rubHintText: $('rub-hint-text'),
  hoverTip: $('hover-tip'),
  toast: $('toast'),
  soundButton: $('btn-sound'),
  cameraButton: $('btn-camera'),
  qualityButton: $('btn-quality'),
  qualityLabel: $('quality-label'),
  shakeButton: $('btn-shake'),
  helpButton: $('btn-help'),
  helpModal: $('help-modal'),
  resultModal: $('result-modal'),
  resultTime: $('result-time'),
  resultScore: $('result-score'),
  resultRpm: $('result-rpm'),
  resultLine: $('result-line'),
  resultBest: $('result-best'),
  retry: $('btn-retry'),
  gesturePanel: $('gesture-panel'),
  gestureClose: $('btn-gesture-close'),
  gestureVideo: $('gesture-video'),
  gestureOverlay: $('gesture-overlay'),
  gesturePlaceholder: $('gesture-placeholder'),
  gestureBadge: $('gesture-badge'),
  gestureStatus: $('gesture-status'),
  gestureFill: $('gesture-fill'),
  cameraStart: $('btn-camera-start'),
  fps: $('fps-badge'),
};

const records = loadRecords();
let recordsDirty = false;

const physics = new BambooPhysics();
const audio = new CicadaAudio();
let scene = null;

let started = false;
let elapsed = 0;
let fps = 60;
let fpsFrames = 0;
let fpsAt = performance.now();
let uiAt = 0;
let challengeUiAt = 0;
let hintHidden = false;
let idleSince = performance.now();
let lastHapticAt = 0;
let toastTimer = 0;
let cameraWanted = false;
let cameraToken = 0;
let motionEnabled = false;
let lastMotionMagnitude = 0;
let lastShakeAt = 0;
let lastShakeToastAt = 0;
let sessionMaxRpm = 0;
let bestRpmNotified = records.bestRpm;
let gestureEnergy = 0;
let hoverAt = 0;
let scrub = null;

const challenge = {
  mode: 'free',
  singTime: 0,
  score: 0,
  combo: 1,
  grace: 0,
  belowTime: 0,
  maxRpm: 0,
  aboveEver: false,
  startedWith: 'manual',
};

const hand = new HandGestureController({
  onRub: (distance, direction, strength) => {
    physics.rub(distance * 1.9, direction, 1.15);
    idleSince = performance.now();
    lastInteractionAt = performance.now();
  },
  onStatus: (message, kind) => {
    setGestureStatus(message, kind);
  },
  onEnergy: (value) => {
    gestureEnergy = clamp(value, 0, 1);
    dom.gestureFill.style.width = `${Math.round(gestureEnergy * 100)}%`;
  },
});

function loadRecords() {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (!raw) return { bestTime: 0, bestScore: 0, bestRpm: 0, runs: 0 };
    const parsed = JSON.parse(raw);
    return {
      bestTime: Number(parsed.bestTime) || 0,
      bestScore: Math.round(Number(parsed.bestScore) || 0),
      bestRpm: Math.round(Number(parsed.bestRpm) || 0),
      runs: Math.round(Number(parsed.runs) || 0),
    };
  } catch (error) {
    return { bestTime: 0, bestScore: 0, bestRpm: 0, runs: 0 };
  }
}

function saveRecords() {
  if (!recordsDirty) return;
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(records));
    recordsDirty = false;
  } catch (error) {
    // Storage may be unavailable in privacy modes; the game still works.
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--';
  return `${seconds.toFixed(1)}s`;
}

function showToast(message, duration = 2300) {
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), duration);
}

function setGestureStatus(message, kind = 'idle') {
  dom.gestureStatus.textContent = message;
  dom.gestureBadge.textContent = ({
    loading: '加载中',
    ready: '摄像头就绪',
    searching: '寻找手掌',
    live: '已识别手掌',
    error: '需要摄像头',
    idle: '摄像头未开启',
  })[kind] || '摄像头';
  dom.gestureBadge.classList.toggle('is-live', kind === 'live' || kind === 'ready');
  dom.gesturePlaceholder.hidden = kind === 'live' || kind === 'ready' || kind === 'searching';
}

function buildGauge() {
  const path = dom.gaugeValue;
  const length = path.getTotalLength();
  path.style.strokeDasharray = `${length}`;
  path.style.strokeDashoffset = `${length}`;
  path.dataset.length = `${length}`;

  const cx = 110;
  const cy = 120;
  const radius = 84;
  const start = -130;
  const sweep = 260;
  const ns = 'http://www.w3.org/2000/svg';
  let html = '';
  for (let i = 0; i <= 10; i++) {
    const angle = ((start + (sweep * i) / 10) * Math.PI) / 180;
    const r1 = radius - (i % 5 === 0 ? 12 : 8);
    const x1 = cx + Math.sin(angle) * r1;
    const y1 = cy - Math.cos(angle) * r1;
    const x2 = cx + Math.sin(angle) * (radius - 2);
    const y2 = cy - Math.cos(angle) * (radius - 2);
    html += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${i % 5 === 0 ? 'major' : ''}"/>`;
  }
  const thresholdAngle = ((start + (sweep * SING_RPM) / MAX_RPM) * Math.PI) / 180;
  const tx1 = cx + Math.sin(thresholdAngle) * (radius - 14);
  const ty1 = cy - Math.cos(thresholdAngle) * (radius - 14);
  const tx2 = cx + Math.sin(thresholdAngle) * (radius - 1);
  const ty2 = cy - Math.cos(thresholdAngle) * (radius - 1);
  html += `<line x1="${tx1.toFixed(1)}" y1="${ty1.toFixed(1)}" x2="${tx2.toFixed(1)}" y2="${ty2.toFixed(1)}" class="threshold"/>`;
  dom.gaugeTicks.innerHTML = html;
  dom.gaugeMarker.setAttribute('cx', tx2.toFixed(1));
  dom.gaugeMarker.setAttribute('cy', ty2.toFixed(1));
  dom.gaugeMarker.setAttribute('r', '2.6');
  dom.gaugeMarker.classList.remove('gauge-marker');
  dom.gaugeMarker.setAttribute('fill', '#e3b768');
}

function updateGauge() {
  const rpm = physics.rpm;
  const ratio = clamp(rpm / MAX_RPM, 0, 1);
  const length = Number(dom.gaugeValue.dataset.length) || 455;
  dom.gaugeValue.style.strokeDashoffset = `${length * (1 - ratio)}`;
  const angle = -130 + ratio * 260;
  dom.gaugeNeedle.style.transform = `rotate(${angle}deg)`;
  dom.rpm.textContent = Math.round(rpm).toString();
  dom.singState.classList.toggle('is-singing', rpm >= SING_RPM);
  if (rpm < 30) dom.singState.textContent = '静止';
  else if (rpm < SING_RPM) dom.singState.textContent = '低鸣';
  else if (rpm < 3000) dom.singState.textContent = '蝉鸣';
  else dom.singState.textContent = '高亢';
}

function updateSoundReadout() {
  const rpm = physics.rpm;
  const stats = audio.getStats();
  const audible = rpm > 190;
  dom.freq.textContent = audible ? Math.round(estimateFundamental(rpm)).toString() : '--';
  const db = stats.levelDb;
  dom.level.textContent = audible && db > -70 ? db.toFixed(0) : '--';
  if (!audio.ready) {
    dom.audioState.textContent = started ? '合成器准备中' : '点击唤醒';
  } else if (audio.muted) {
    dom.audioState.textContent = '已静音';
  } else if (audio.ctx?.state === 'running') {
    dom.audioState.textContent = rpm > 190 ? '实时合成' : '待风来';
  } else {
    dom.audioState.textContent = '已暂停';
  }
}

function updateChallengeUI() {
  dom.singTime.textContent = challenge.mode === 'free' ? '0.0' : challenge.singTime.toFixed(1);
  dom.score.textContent = Math.round(challenge.score).toLocaleString('zh-CN');
  dom.combo.textContent = `×${challenge.mode === 'running' ? challenge.combo.toFixed(1) : '1.0'}`;
  dom.bestTime.textContent = formatTime(records.bestTime);
  dom.challengeCard.classList.toggle('is-live', challenge.mode === 'running');
  dom.liveDot.classList.toggle('live-dot', true);

  let stateText = '自由练习 · 不计分';
  let progress = clamp(physics.rpm / MAX_RPM, 0, 1);
  if (challenge.mode === 'running') {
    if (challenge.aboveEver && challenge.belowTime > 0) {
      stateText = `蝉声将断 · ${Math.max(0, 2.2 - challenge.belowTime).toFixed(1)}s`;
      progress = 1 - clamp(challenge.belowTime / 2.2, 0, 1);
    } else if (challenge.aboveEver) {
      stateText = `连鸣中 · ${Math.round(physics.rpm)} RPM`;
      progress = clamp(challenge.singTime / 60, 0, 1);
    } else {
      stateText = `把转速提到 ${SING_RPM} RPM`;
      progress = clamp(physics.rpm / SING_RPM, 0, 1);
    }
  } else if (challenge.mode === 'ended') {
    stateText = '本局结束 · 等待再战';
    progress = 0;
  }
  dom.challengeState.textContent = stateText;
  dom.challengeProgress.style.width = `${Math.round(progress * 100)}%`;
  dom.challengeButton.textContent = challenge.mode === 'running' ? '结束本局' : challenge.mode === 'ended' ? '再次挑战' : '开始挑战';
}

function updateHint() {
  const idle = performance.now() - idleSince;
  const show = started && !hintHidden && physics.rpm < 80 && idle > (scrub ? 999999 : 1200);
  if (show) {
    dom.rubHint.classList.remove('is-hidden');
    dom.rubHintText.textContent = window.matchMedia('(pointer: coarse)').matches
      ? '按住竹签左右搓动 · 或摇一摇手机'
      : '按住竹签，左右快速搓动';
  } else {
    dom.rubHint.classList.add('is-hidden');
  }
}

function updateChallenge(dt) {
  if (challenge.mode !== 'running') return;
  const rpm = physics.rpm;
  challenge.maxRpm = Math.max(challenge.maxRpm, rpm);

  if (rpm >= SING_RPM) {
    if (!challenge.aboveEver) {
      challenge.aboveEver = true;
      challenge.grace = 0;
      showToast('蝉鸣起来了，保持住！', 1200);
    }
    challenge.singTime += dt;
    challenge.belowTime = 0;
    const speedBonus = clamp((rpm - SING_RPM) / (MAX_RPM - SING_RPM), 0, 1);
    challenge.combo = 1 + speedBonus * 2.7;
    challenge.score += dt * 110 * challenge.combo;
  } else if (challenge.aboveEver) {
    challenge.combo = 0.9;
    challenge.belowTime += dt;
    if (challenge.belowTime >= 2.2) {
      endChallenge('interrupted');
    }
  } else {
    challenge.grace += dt;
    if (challenge.grace >= 9) {
      endChallenge('failed');
    }
  }
}

function startChallenge() {
  if (challenge.mode === 'running') {
    endChallenge('manual');
    return;
  }
  challenge.mode = 'running';
  challenge.singTime = 0;
  challenge.score = 0;
  challenge.combo = 1;
  challenge.grace = 0;
  challenge.belowTime = 0;
  challenge.maxRpm = physics.rpm;
  challenge.aboveEver = physics.rpm >= SING_RPM;
  challenge.startedWith = 'manual';
  dom.resultModal.hidden = true;
  hintHidden = false;
  lastInteractionAt = performance.now();
  idleSince = performance.now();
  updateChallengeUI();
  syncPauseState();
  showToast(`挑战开始 · 让蝉鸣超过 ${SING_RPM} RPM`, 2200);
}

function endChallenge(reason = 'manual') {
  if (challenge.mode !== 'running') return;
  challenge.mode = 'ended';
  const previousBestTime = records.bestTime;
  const previousBestScore = records.bestScore;
  const previousBestRpm = records.bestRpm;

  if (challenge.singTime > records.bestTime) records.bestTime = challenge.singTime;
  if (challenge.score > records.bestScore) records.bestScore = Math.round(challenge.score);
  if (challenge.maxRpm > records.bestRpm) records.bestRpm = Math.round(challenge.maxRpm);
  records.runs += 1;
  recordsDirty = true;
  saveRecords();

  const newBest = challenge.singTime > previousBestTime + 0.05;
  const newScore = challenge.score > previousBestScore;
  const newRpm = challenge.maxRpm > previousBestRpm + 5;
  dom.resultTime.innerHTML = `${challenge.singTime.toFixed(1)}<small>s</small>`;
  dom.resultScore.textContent = Math.round(challenge.score).toLocaleString('zh-CN');
  dom.resultRpm.innerHTML = `${Math.round(challenge.maxRpm).toLocaleString('zh-CN')}<small>RPM</small>`;
  dom.resultLine.textContent = reason === 'failed'
    ? '蝉声还没响起来，再搓快一点。'
    : challenge.singTime < 3
      ? '刚听见一点夏天，再来一次。'
      : challenge.singTime < 12
        ? '有点夏天的意思了。'
        : challenge.singTime < 30
          ? '耳朵已经进入竹林。'
          : '你把整个夏天都搓响了。';

  const badges = [];
  if (newBest) badges.push('连续蝉鸣新纪录');
  if (newScore) badges.push('得分新高');
  if (newRpm) badges.push('转速新高');
  dom.resultBest.textContent = badges.length
    ? `新纪录 · ${badges.join(' · ')}`
    : `最佳 ${formatTime(records.bestTime)} · 最高 ${records.bestRpm.toLocaleString('zh-CN')} RPM`;
  dom.resultBest.style.color = badges.length ? '#efd08f' : 'rgba(232, 211, 172, 0.55)';
  dom.resultModal.hidden = false;
  hintHidden = true;
  updateChallengeUI();
  syncPauseState();
  if (newBest) showToast(`新纪录：连续蝉鸣 ${challenge.singTime.toFixed(1)} 秒`, 3000);
}

function closeResult(keepFree = true) {
  dom.resultModal.hidden = true;
  if (keepFree) {
    challenge.mode = 'free';
    challenge.singTime = 0;
    challenge.score = 0;
    challenge.combo = 1;
    challenge.aboveEver = false;
    challenge.belowTime = 0;
    challenge.grace = 0;
  }
  updateChallengeUI();
  syncPauseState();
}

function resetChallenge() {
  challenge.mode = 'free';
  challenge.singTime = 0;
  challenge.score = 0;
  challenge.combo = 1;
  challenge.grace = 0;
  challenge.belowTime = 0;
  challenge.aboveEver = false;
  dom.resultModal.hidden = true;
  updateChallengeUI();
  syncPauseState();
}

async function startAudio() {
  try {
    await audio.start();
    audio.setRpm(physics.rpm, true);
    dom.audioState.textContent = '实时合成';
    return true;
  } catch (error) {
    console.warn(error);
    showToast(`声音未能启动：${error.message || '浏览器限制'}`, 3500);
    dom.audioState.textContent = '声音不可用';
    return false;
  }
}

function setMuted(muted) {
  audio.setMuted(muted);
  dom.soundButton.classList.toggle('is-muted', muted);
  dom.soundButton.setAttribute('aria-label', muted ? '打开声音' : '关闭声音');
  dom.soundButton.setAttribute('aria-pressed', String(!muted));
  updateSoundReadout();
}

async function startExperience() {
  if (started) return;
  started = true;
  dom.app.classList.remove('is-intro');
  dom.intro.classList.add('is-closing');
  scene.setIntroMode(false);
  lastInteractionAt = performance.now();
  idleSince = performance.now();
  setTimeout(() => { dom.intro.hidden = true; }, 900);
  updateChallengeUI();
  startAudio();
  startRenderLoop();
  if (softwareGPU) {
    showToast('检测到软件 WebGL，已启用 24fps 极限省电模式', 4200);
  }
  if (window.matchMedia('(pointer: coarse)').matches && navigator.vibrate) {
    setTimeout(() => navigator.vibrate(12), 250);
  }
}

function openHelp() {
  lastInteractionAt = performance.now();
  dom.helpModal.hidden = false;
  syncPauseState();
}

function closeModal(id) {
  const modal = $(id);
  if (modal) modal.hidden = true;
  lastInteractionAt = performance.now();
  syncPauseState();
}

function toggleGesturePanel() {
  lastInteractionAt = performance.now();
  const willOpen = dom.gesturePanel.hidden;
  dom.gesturePanel.hidden = !willOpen;
  dom.cameraButton.classList.toggle('is-active', willOpen);
  if (willOpen) {
    gestureEnergy = 0;
    dom.gestureFill.style.width = '0%';
    setGestureStatus('摄像头与 MediaPipe 默认关闭；点击下方按钮才会启动（15fps）。', 'idle');
  } else {
    stopCamera();
  }
}

async function startCamera() {
  if (hand.running) return;
  cameraWanted = true;
  const token = ++cameraToken;
  dom.cameraStart.hidden = true;
  dom.gesturePlaceholder.hidden = false;
  setGestureStatus('正在启动摄像头…', 'loading');
  try {
    await hand.start(dom.gestureVideo, dom.gestureOverlay);
    if (!cameraWanted || token !== cameraToken) {
      hand.stop();
      return;
    }
    dom.cameraStart.hidden = false;
    dom.cameraStart.textContent = '关闭摄像头';
    dom.cameraStart.classList.add('btn-ghost');
    dom.cameraStart.classList.remove('btn-solid');
    dom.gesturePlaceholder.hidden = true;
  } catch (error) {
    if (token !== cameraToken) return;
    console.warn(error);
    const message = /Permission|denied|NotAllowed/i.test(error.message || '')
      ? '摄像头权限被拒绝。若想使用手势，请在浏览器地址栏允许摄像头。'
      : `${error.message || '摄像头启动失败'}。可以改用鼠标、触屏或摇一摇。`;
    setGestureStatus(message, 'error');
    dom.gesturePlaceholder.hidden = false;
    dom.cameraStart.hidden = false;
    dom.cameraStart.textContent = '重新尝试';
    dom.cameraStart.classList.add('btn-solid');
    dom.cameraStart.classList.remove('btn-ghost');
  }
}

function stopCamera() {
  cameraWanted = false;
  cameraToken++;
  hand.stop();
  gestureEnergy = 0;
  dom.gestureFill.style.width = '0%';
  setGestureStatus('摄像头已关闭。开启后，对着镜头左右搓动手掌。', 'idle');
  dom.gesturePlaceholder.hidden = false;
  dom.cameraStart.hidden = false;
  dom.cameraStart.textContent = '开启摄像头';
  dom.cameraStart.classList.add('btn-solid');
  dom.cameraStart.classList.remove('btn-ghost');
  dom.cameraButton.classList.remove('is-active');
}

function onCameraStartClick() {
  lastInteractionAt = performance.now();
  if (hand.running) {
    stopCamera();
    return;
  }
  startCamera();
}

async function toggleShake() {
  lastInteractionAt = performance.now();
  if (motionEnabled) {
    motionEnabled = false;
    dom.shakeButton.classList.remove('is-active');
    dom.shakeButton.setAttribute('aria-pressed', 'false');
    showToast('摇一摇已关闭');
    return;
  }

  if (!('DeviceMotionEvent' in window)) {
    showToast('当前设备不支持体感摇一摇');
    return;
  }
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== 'granted') {
        showToast('未获得体感权限，可以改用鼠标或触屏');
        return;
      }
    }
    motionEnabled = true;
    dom.shakeButton.classList.add('is-active');
    dom.shakeButton.setAttribute('aria-pressed', 'true');
    lastMotionMagnitude = 0;
    showToast('摇一摇已开启 · 晃动手机给竹翼加速', 2600);
  } catch (error) {
    console.warn(error);
    showToast('体感权限开启失败');
  }
}

function handleMotion(event) {
  if (!motionEnabled) return;
  const acc = event.acceleration || event.accelerationIncludingGravity;
  if (!acc) return;
  const x = acc.x || 0;
  const y = acc.y || 0;
  const z = acc.z || 0;
  const magnitude = Math.hypot(x, y, z);
  const jerk = Math.abs(magnitude - lastMotionMagnitude);
  lastMotionMagnitude = magnitude;
  const now = performance.now();
  if (now - lastShakeAt < 180) return;
  const threshold = event.acceleration ? 15 : 22;
  if (jerk > threshold || (event.acceleration && magnitude > 26)) {
    lastShakeAt = now;
    lastInteractionAt = now;
    physics.kick(0.95);
    idleSince = now;
    hintHidden = true;
    if (navigator.vibrate) navigator.vibrate(35);
    if (now - lastShakeToastAt > 3200) {
      lastShakeToastAt = now;
      showToast('摇得漂亮，竹翼加速中');
    }
  }
}

function onPointerDown(event) {
  if (!started || dom.helpModal.hidden === false || dom.resultModal.hidden === false) return;
  if (event.target !== dom.canvas) return;
  if (event.button !== undefined && event.button !== 0) return;
  lastInteractionAt = performance.now();

  const hit = scene.pick(event.clientX, event.clientY);
  const anchor = scene.getToyAnchor();
  const distance = Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y);
  const nearToy = anchor.visible && distance < Math.min(window.innerWidth, window.innerHeight) * 0.2 + 32;
  if (!hit && !nearToy) return;

  // Capture phase listener on window: stop OrbitControls from starting a camera drag.
  event.preventDefault();
  event.stopPropagation();
  lastInteractionAt = performance.now();
  if (event.pointerId !== undefined && dom.canvas.setPointerCapture) {
    try { dom.canvas.setPointerCapture(event.pointerId); } catch (error) { /* noop */ }
  }
  scrub = {
    pointerId: event.pointerId,
    lastX: event.clientX,
    lastY: event.clientY,
    lastAt: performance.now(),
    startAt: performance.now(),
    moved: 0,
    taps: 0,
  };
  hintHidden = true;
  idleSince = performance.now();
  scene.controls.enabled = false;
  dom.canvas.classList.add('is-scrubbing');
  dom.hoverTip.classList.remove('is-visible');
}

function onPointerMove(event) {
  if (!scrub || event.pointerId !== scrub.pointerId) {
    if (event.target === dom.canvas) lastInteractionAt = performance.now();
    if (event.pointerType === 'mouse' && started && event.target === dom.canvas) updateHover(event);
    else dom.hoverTip.classList.remove('is-visible');
    return;
  }
  event.preventDefault();
  const now = performance.now();
  lastInteractionAt = now;
  const dt = clamp((now - scrub.lastAt) / 1000, 0.008, 0.075);
  const dx = event.clientX - scrub.lastX;
  const dy = event.clientY - scrub.lastY;
  const distPx = Math.hypot(dx, dy);
  if (distPx < 0.3) return;
  scrub.lastX = event.clientX;
  scrub.lastY = event.clientY;
  scrub.lastAt = now;
  scrub.moved += distPx;

  const minDim = Math.min(window.innerWidth, window.innerHeight);
  const normalized = (distPx / Math.max(320, minDim)) * 0.52;
  const speedPx = distPx / dt;
  const strength = clamp(speedPx / 950, 0.42, 1.35);
  const direction = Math.abs(dx) > Math.abs(dy) * 0.3 ? Math.sign(dx) || 1 : 1;
  physics.rub(normalized, direction, strength);
  idleSince = now;
  hintHidden = true;

  if (distPx > 12 && now - lastHapticAt > 120 && navigator.vibrate) {
    lastHapticAt = now;
    navigator.vibrate(Math.min(8, Math.round(strength * 5)));
  }
  if (event.pointerType === 'mouse') {
    dom.hoverTip.classList.remove('is-visible');
  }
}

function onPointerUp(event) {
  if (!scrub || (event.pointerId !== undefined && event.pointerId !== scrub.pointerId)) return;
  lastInteractionAt = performance.now();
  const quickTap = scrub.moved < 10 && performance.now() - scrub.startAt < 260;
  scrub = null;
  scene.controls.enabled = true;
  dom.canvas.classList.remove('is-scrubbing');
  if (quickTap) {
    physics.kick(0.6);
    idleSince = performance.now();
    hintHidden = true;
    showToast('轻甩一下 · 再搓会更响', 1100);
  }
  try { dom.canvas.releasePointerCapture(event.pointerId); } catch (error) { /* noop */ }
}

function updateHover(event) {
  const now = performance.now();
  if (now - hoverAt < 45) return;
  hoverAt = now;
  const hit = scene.pick(event.clientX, event.clientY);
  if (!hit) {
    dom.hoverTip.classList.remove('is-visible');
    return;
  }
  dom.hoverTip.style.left = `${event.clientX}px`;
  dom.hoverTip.style.top = `${event.clientY}px`;
  dom.hoverTip.classList.add('is-visible');
}

function onKeyDown(event) {
  if (!started) return;
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  lastInteractionAt = performance.now();

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    physics.addAngularImpulse(22 * physics.spinDirection, 'keyboard');
    idleSince = performance.now();
    hintHidden = true;
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    if (event.repeat) return;
    physics.kick(0.7);
    idleSince = performance.now();
    hintHidden = true;
    showToast('轻甩 +1', 900);
    return;
  }
  if (event.key === 'Escape') {
    if (!dom.helpModal.hidden) closeModal('help-modal');
    else if (!dom.resultModal.hidden) closeResult();
    else if (!dom.gesturePanel.hidden) {
      dom.gesturePanel.hidden = true;
      stopCamera();
    }
    return;
  }
  if (event.key.toLowerCase() === 'm') {
    setMuted(!audio.muted);
  }
  if (event.key.toLowerCase() === 'q') {
    toggleQualityMode();
  }
}

function shouldPauseGame() {
  return document.hidden || !dom.helpModal.hidden || !dom.resultModal.hidden;
}

function stopRenderLoop() {
  renderLoopActive = false;
  if (animationHandle) cancelAnimationFrame(animationHandle);
  animationHandle = 0;
}

function startRenderLoop() {
  if (!scene || renderLoopActive || shouldPauseGame()) return;
  renderLoopActive = true;
  lastLoopAt = performance.now();
  frameBudgetMs = 0;
  simAccumulator = 0;
  fpsFrames = 0;
  fpsAt = performance.now();
  animationHandle = requestAnimationFrame(updateLoop);
}

function syncPauseState() {
  if (!scene) return;
  if (shouldPauseGame()) {
    stopRenderLoop();
    stopCamera();
    audio.suspend().catch(() => {});
    return;
  }
  startRenderLoop();
  lastLoopAt = performance.now();
  frameBudgetMs = 0;
  simAccumulator = 0;
  if (started) audio.resume().catch(() => {});
}

function updateQualityButton() {
  const high = qualityMode === 'quality';
  dom.qualityButton.classList.toggle('is-active', high);
  dom.qualityButton.setAttribute('aria-pressed', String(high));
  dom.qualityButton.setAttribute('aria-label', high ? '切换到流畅模式' : '切换到高画质');
  dom.qualityButton.title = high ? '画质：高画质（60fps / AfterimagePass）' : '画质：流畅（30fps / 轻量残影）';
  dom.qualityLabel.textContent = high ? '高画质' : '流畅';
}

function applyQuality(mode) {
  const applied = scene.setQuality(mode);
  qualityMode = applied;
  lowPower = false;
  lowPerfSeconds = 0;
  targetFps = applied === 'quality' ? MAX_FPS : (softwareGPU ? SOFTWARE_FPS : IDLE_FPS);
  frameBudgetMs = 0;
  lastInteractionAt = performance.now();
  updateQualityButton();
  return applied;
}

function toggleQualityMode() {
  const requested = qualityMode === 'quality' ? 'performance' : 'quality';
  const applied = applyQuality(requested);
  if (requested === 'quality' && applied !== 'quality') {
    showToast('当前环境的 WebGL 为软件渲染，已保持流畅模式', 3600);
    return;
  }
  if (applied === 'quality') {
    showToast('高画质：1080p / 60fps / AfterimagePass，GPU 负载会明显上升', 3800);
  } else {
    showToast('流畅模式：720p / 30fps / 轻量竹翼残影', 2800);
  }
}

function enableLowPowerMode() {
  if (lowPower) return;
  lowPower = true;
  qualityMode = 'performance';
  targetFps = softwareGPU ? SOFTWARE_FPS : IDLE_FPS;
  lowPerfSeconds = 0;
  scene?.setLowPower(true);
  updateQualityButton();
  showToast('检测到持续低帧率，已切回流畅模式（30fps / 720p）', 3800);
}

function handleVisibility() {
  syncPauseState();
}

function updateLoop(now) {
  if (!renderLoopActive) return;
  animationHandle = requestAnimationFrame(updateLoop);
  if (shouldPauseGame()) return;

  if (!lastLoopAt) lastLoopAt = now;
  let elapsedMs = Math.max(0, now - lastLoopAt);
  lastLoopAt = now;
  elapsedMs = Math.min(elapsedMs, 200);
  frameBudgetMs += elapsedMs;
  if (frameBudgetMs > 100) frameBudgetMs = 1000 / targetFps;

  const recentlyInteracting = now - lastInteractionAt < 1200;
  const active = physics.rpm > 12 || Boolean(scrub) || recentlyInteracting;
  const performanceFps = softwareGPU ? SOFTWARE_FPS : IDLE_FPS;
  targetFps = qualityMode === 'performance' || lowPower
    ? performanceFps
    : (active ? MAX_FPS : IDLE_FPS);
  const frameInterval = 1000 / targetFps;
  if (frameBudgetMs + 0.2 < frameInterval) return;

  const rawDt = Math.min(frameBudgetMs / 1000, MAX_FRAME_DT);
  frameBudgetMs = Math.max(0, frameBudgetMs - frameInterval);
  if (rawDt <= 0) return;

  elapsed += rawDt;

  // Fixed-step accumulator based on real elapsed time, hard-capped so a slow
  // frame can never trigger a spiral of death.
  simAccumulator = Math.min(simAccumulator + rawDt, FIXED_STEP * MAX_SUBSTEPS);
  let steps = 0;
  while (simAccumulator >= FIXED_STEP - 1e-9 && steps < MAX_SUBSTEPS) {
    physics.step(FIXED_STEP);
    simAccumulator -= FIXED_STEP;
    steps++;
  }
  if (steps >= MAX_SUBSTEPS) simAccumulator = 0;

  const rpm = physics.rpm;
  sessionMaxRpm = Math.max(sessionMaxRpm, rpm);
  if (rpm > bestRpmNotified + 50) {
    bestRpmNotified = rpm;
  }

  audio.setRpm(rpm);
  updateChallenge(rawDt);

  scene.update(rawDt, elapsed, {
    speedRatio: physics.speedRatio,
    angle: physics.angle,
    tiltX: physics.tiltX,
    tiltZ: physics.tiltZ,
    bob: physics.bob,
    rubPulse: physics.rubPulse,
  });

  fpsFrames++;
  if (now - fpsAt > 1000) {
    const measured = (fpsFrames * 1000) / (now - fpsAt);
    fps = Math.round(measured);
    fpsFrames = 0;
    fpsAt = now;
    if (!lowPower && started && qualityMode === 'quality' && active && measured < 48) {
      lowPerfSeconds++;
      if (lowPerfSeconds >= 3) enableLowPowerMode();
    } else {
      lowPerfSeconds = 0;
    }
    if (dom.fps && !dom.fps.hidden) dom.fps.textContent = `${fps} FPS`;
  }

  if (now - uiAt > 100) {
    uiAt = now;
    updateGauge();
    updateSoundReadout();
    updateHint();
  }
  if (now - challengeUiAt > 200) {
    challengeUiAt = now;
    updateChallengeUI();
  }
}

function registerEvents() {
  dom.start.addEventListener('click', startExperience);
  dom.challengeButton.addEventListener('click', () => {
    if (challenge.mode === 'running') endChallenge('manual');
    else startChallenge();
  });
  dom.challengeReset.addEventListener('click', resetChallenge);
  dom.retry.addEventListener('click', () => {
    closeResult(false);
    challenge.mode = 'free';
    startChallenge();
  });
  dom.soundButton.addEventListener('click', async () => {
    if (!audio.ready) {
      const ok = await startAudio();
      if (ok) setMuted(false);
      return;
    }
    setMuted(!audio.muted);
  });
  dom.cameraButton.addEventListener('click', toggleGesturePanel);
  dom.qualityButton.addEventListener('click', toggleQualityMode);
  dom.gestureClose.addEventListener('click', () => {
    dom.gesturePanel.hidden = true;
    stopCamera();
  });
  dom.cameraStart.addEventListener('click', onCameraStartClick);
  dom.shakeButton.addEventListener('click', toggleShake);
  dom.helpButton.addEventListener('click', openHelp);
  dom.resultModal.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => closeResult());
  });
  dom.helpModal.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => closeModal('help-modal'));
  });
  dom.helpModal.addEventListener('click', (event) => {
    if (event.target === dom.helpModal) closeModal('help-modal');
  });
  dom.resultModal.addEventListener('click', (event) => {
    if (event.target === dom.resultModal) closeResult();
  });

  window.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('devicemotion', handleMotion);
  window.addEventListener('wheel', () => { lastInteractionAt = performance.now(); }, { passive: true });
  let resizeTimer = 0;
  const requestResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => scene?.resize(), 120);
  };
  window.addEventListener('resize', requestResize);
  window.addEventListener('orientationchange', requestResize);
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) scene?.dispose();
  });

  window.addEventListener('blur', () => {
    if (scrub) {
      scrub = null;
      if (scene) scene.controls.enabled = true;
      dom.canvas.classList.remove('is-scrubbing');
    }
  });
}

function exposeDebugApi() {
  window.__bamboo = {
    getState() {
      return {
        started,
        rpm: physics.rpm,
        omega: physics.omega,
        angle: physics.angle,
        speedRatio: physics.speedRatio,
        audioReady: audio.ready,
        audioState: audio.ctx?.state || 'none',
        audioMuted: audio.muted,
        challenge: { ...challenge },
        records: { ...records },
        fps,
        targetFps,
        lowPower,
        qualityMode,
        usePost: scene?.usePost || false,
        gpuRenderer: scene?.gpuRenderer || '',
        softwareGPU: scene?.softwareGPU || false,
        maxRenderPixels: scene?.maxRenderPixels || 0,
        pixelRatio: scene?.pixelRatio || 1,
        drawCalls: scene?.renderer.info.render.calls || 0,
        renderedFrames: scene?.renderedFrames || 0,
        handRunning: hand.running,
        loopActive: renderLoopActive,
      };
    },
    setRpm(rpm, direction = 1) {
      physics.setRpm(rpm, direction);
    },
    setOmega(omega) {
      physics.setOmega(omega);
    },
    impulse(amount) {
      physics.addAngularImpulse(amount);
    },
    startChallenge,
    endChallenge,
    resetChallenge,
    startExperience,
    testAudio(rpm, seconds = 2.4) {
      return audio.testRender(rpm, seconds);
    },
    scene,
    physics,
    audio,
    hand,
  };
}

async function boot() {
  try {
    scene = new BambooScene(dom.canvas);
    softwareGPU = scene.softwareGPU;
    exposeDebugApi();
    applyQuality('performance');
    buildGauge();
    registerEvents();
    updateChallengeUI();
    updateGauge();
    scene.screenshotReady();
    requestAnimationFrame(() => {
      dom.loading.classList.add('is-done');
      setTimeout(() => { dom.loading.hidden = true; }, 750);
    });
    startRenderLoop();
  } catch (error) {
    console.error(error);
    dom.loading.innerHTML = `<div class="loading-mark">!</div><p>3D 场景启动失败</p><p style="max-width:420px;text-align:center;line-height:1.7;color:rgba(241,230,208,.5)">${error.message}</p>`;
  }
}

window.addEventListener('error', (event) => {
  console.error('Unhandled error', event.error || event.message);
});

boot();
