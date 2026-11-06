import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CHROME = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate)) || 'google-chrome';
const BASE = process.env.BAMBOO_CICADA_URL || 'http://127.0.0.1:4173/';
const OUT = join(process.cwd(), 'tests', 'artifacts');
await mkdir(OUT, { recursive: true });

const failures = [];
const results = [];
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') browserErrors.push(`console: ${msg.text()}`);
});
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => !!window.__bamboo, { timeout: 60000 });
await page.waitForFunction(() => document.getElementById('loading-screen')?.hidden, { timeout: 30000 });
await sleep(400);

try {
  const initial = await page.evaluate(() => window.__bamboo.getState());
  check('初始界面加载', initial.audioReady === false && initial.rpm === 0, JSON.stringify(initial.records));
  await page.screenshot({ path: join(OUT, 'v01-intro.png') });

  await page.click('#btn-start');
  await sleep(2600);
  const started = await page.evaluate(() => window.__bamboo.getState());
  check('进入竹林并唤醒音频', started.started && started.audioReady && started.audioState === 'running', started.audioState);
  await page.screenshot({ path: join(OUT, 'v02-idle.png') });

  // Performance budget: capped fps, <=1.5 DPR and <=1080p internal pixels.
  const perf = await page.evaluate(() => {
    const scene = window.__bamboo.scene;
    const canvas = scene.renderer.domElement;
    return {
      pixelRatio: scene.renderer.getPixelRatio(),
      bufferPixels: canvas.width * canvas.height,
      drawCalls: scene.renderer.info.render.calls,
      max4kRatio: scene._computePixelRatio(3840, 2160),
      targetFps: window.__bamboo.getState().targetFps,
    };
  });
  check('像素比不超过 1.5', perf.pixelRatio <= 1.5 + 1e-6, `dpr=${perf.pixelRatio.toFixed(2)}`);
  check('默认流畅模式使用 720p 像素预算', perf.bufferPixels <= 1280 * 720 + 2000, `${perf.bufferPixels} px`);
  check('4K 窗口自动降采样', perf.max4kRatio <= 0.34, `ratio=${perf.max4kRatio.toFixed(2)}`);
  check('Draw call 已大幅削减', perf.drawCalls < 90, `${perf.drawCalls} calls`);
  check('默认使用轻量性能模式', started.qualityMode === 'performance' && started.usePost === false, started.qualityMode);

  const idleStart = await page.evaluate(() => ({
    frames: window.__bamboo.scene.renderedFrames,
    now: performance.now(),
  }));
  await sleep(2200);
  const idleEnd = await page.evaluate(() => ({
    frames: window.__bamboo.scene.renderedFrames,
    now: performance.now(),
    targetFps: window.__bamboo.getState().targetFps,
  }));
  const idleFps = (idleEnd.frames - idleStart.frames) / ((idleEnd.now - idleStart.now) / 1000);
  check('空闲帧率限制为 30fps', idleEnd.targetFps === 30 && idleFps <= 31, `${idleEnd.targetFps} target / ${idleFps.toFixed(1)} measured`);

  // Offline audio analysis across the RPM range.
  const audio = [];
  for (const rpm of [0, 300, 800, 1800, 3000, 4500, 5200]) {
    const r = await page.evaluate(async (value) => window.__bamboo.testAudio(value, 2.4), rpm);
    audio.push(r);
    console.log('AUDIO', JSON.stringify(r));
  }
  check('静止时完全静音', audio[0].rms < 1e-5, `rms=${audio[0].rms.toExponential(2)}`);
  const loudness = audio.map((a) => a.rms);
  const pitch = audio.map((a) => a.dominantHz);
  check('响度随转速单调上升', loudness.every((v, i) => i === 0 || v > loudness[i - 1]), loudness.map((v) => v.toFixed(3)).join(' < '));
  check('基频随转速单调上升', pitch.every((v, i) => i === 0 || v > pitch[i - 1]), pitch.join(' < '));
  check('高频亮度随转速提升', audio.at(-1).centroidHz > audio[2].centroidHz * 1.5, `${audio[2].centroidHz} → ${audio.at(-1).centroidHz} Hz`);
  check('包含低频“哇呜”调制', audio[4].modDepth > 0.08 && audio[4].modHz > 1 && audio[4].modHz < 10, `depth=${audio[4].modDepth}, ${audio[4].modHz}Hz`);

  // Real-time analyser: level rises then fades.
  await page.evaluate(() => window.__bamboo.setRpm(3000));
  await sleep(1400);
  const activeStart = await page.evaluate(() => ({
    frames: window.__bamboo.scene.renderedFrames,
    now: performance.now(),
  }));
  await sleep(2000);
  const activeEnd = await page.evaluate(() => ({
    frames: window.__bamboo.scene.renderedFrames,
    now: performance.now(),
    targetFps: window.__bamboo.getState().targetFps,
  }));
  const activeFps = (activeEnd.frames - activeStart.frames) / ((activeEnd.now - activeStart.now) / 1000);
  check('默认流畅模式锁定 30fps', activeEnd.targetFps === 30 && activeFps <= 31 && activeFps > 24, `${activeEnd.targetFps} target / ${activeFps.toFixed(1)} measured`);
  const loud = await page.evaluate(() => window.__bamboo.audio.getStats());
  await page.evaluate(() => window.__bamboo.setRpm(0));
  await sleep(1300);
  const quiet = await page.evaluate(() => window.__bamboo.audio.getStats());
  check('实时声音随转速出现', loud.levelDb > -45, `${loud.levelDb.toFixed(1)} dB`);
  check('转速归零后声音自然衰减', quiet.levelDb < -55, `${quiet.levelDb.toFixed(1)} dB`);

  // Optional high quality mode: AfterimagePass, 1080p budget and 60fps.
  await page.click('#btn-quality');
  await sleep(700);
  const qualityState = await page.evaluate(() => window.__bamboo.getState());
  check('可切换到高画质 + AfterimagePass', qualityState.qualityMode === 'quality' && qualityState.usePost === true, qualityState.qualityMode);
  await page.evaluate(() => window.__bamboo.setRpm(3000));
  await sleep(1400);
  const qualityStart = await page.evaluate(() => ({
    frames: window.__bamboo.scene.renderedFrames,
    now: performance.now(),
    bufferPixels: window.__bamboo.scene.renderer.domElement.width * window.__bamboo.scene.renderer.domElement.height,
  }));
  await sleep(2000);
  const qualityEnd = await page.evaluate(() => ({
    frames: window.__bamboo.scene.renderedFrames,
    now: performance.now(),
    targetFps: window.__bamboo.getState().targetFps,
  }));
  const qualityFps = (qualityEnd.frames - qualityStart.frames) / ((qualityEnd.now - qualityStart.now) / 1000);
  check('高画质模式锁定 60fps', qualityEnd.targetFps === 60 && qualityFps <= 61 && qualityFps > 50, `${qualityEnd.targetFps} target / ${qualityFps.toFixed(1)} measured`);
  check('高画质仍限制 1080p', qualityStart.bufferPixels <= 1920 * 1080 + 2000, `${qualityStart.bufferPixels} px`);
  await page.screenshot({ path: join(OUT, 'v08-quality-fast.png') });
  await page.click('#btn-quality');
  await sleep(500);
  await page.evaluate(() => window.__bamboo.setRpm(0));
  const backToPerformance = await page.evaluate(() => window.__bamboo.getState());
  check('可切回流畅模式', backToPerformance.qualityMode === 'performance' && backToPerformance.usePost === false, backToPerformance.qualityMode);

  // Natural physical decay.
  await page.evaluate(() => window.__bamboo.setRpm(4200));
  await sleep(1800);
  const decayed = await page.evaluate(() => window.__bamboo.getState());
  check('空气阻力使转速自然衰减', decayed.rpm > 900 && decayed.rpm < 3900, `${Math.round(decayed.rpm)} RPM`);

  // Challenge flow.
  await page.evaluate(() => { window.__bamboo.resetChallenge(); window.__bamboo.setRpm(2600); window.__bamboo.startChallenge(); });
  await sleep(2000);
  const midChallenge = await page.evaluate(() => window.__bamboo.getState());
  check('挑战计时实时增长', midChallenge.challenge.mode === 'running' && midChallenge.challenge.singTime > 1.4, `${midChallenge.challenge.singTime.toFixed(2)}s`);
  check('挑战实时计分', midChallenge.challenge.score > 100, `${Math.round(midChallenge.challenge.score)} 分`);

  await page.evaluate(() => window.__bamboo.setRpm(0));
  await sleep(2600);
  const ended = await page.evaluate(() => window.__bamboo.getState());
  const resultVisible = await page.evaluate(() => !document.getElementById('result-modal').hidden);
  check('蝉鸣中断后结束挑战', ended.challenge.mode === 'ended' && resultVisible);
  check('最佳成绩写入记录', ended.records.bestTime > 0 && ended.records.bestScore > 0, JSON.stringify(ended.records));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bamboo-cicada-records-v1')));
  check('最佳成绩持久化', stored.bestTime > 0, JSON.stringify(stored));
  await page.screenshot({ path: join(OUT, 'v03-result.png') });

  await page.evaluate(() => {
    document.querySelector('#result-modal [data-close]').click();
    window.__bamboo.resetChallenge();
    window.__bamboo.setRpm(0);
  });
  await sleep(200);

  // Mouse scrub.
  const anchor = await page.evaluate(() => window.__bamboo.scene.getToyAnchor());
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  for (let i = 0; i < 14; i++) {
    await page.mouse.move(anchor.x + (i % 2 ? -120 : 120), anchor.y, { steps: 2 });
  }
  await page.mouse.up();
  await sleep(250);
  const afterMouse = await page.evaluate(() => window.__bamboo.getState());
  check('鼠标搓动驱动转速', afterMouse.rpm > 1200, `${Math.round(afterMouse.rpm)} RPM`);
  await page.screenshot({ path: join(OUT, 'v04-fast.png') });

  // Touch scrub via CDP.
  await page.evaluate(() => window.__bamboo.setRpm(0));
  const cdp = await page.createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: anchor.x, y: anchor.y, id: 1 }] });
  for (let i = 0; i < 14; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: anchor.x + (i % 2 ? -95 : 95), y: anchor.y, id: 1 }],
    });
    await sleep(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
  const afterTouch = await page.evaluate(() => window.__bamboo.getState());
  check('触摸搓动驱动转速', afterTouch.rpm > 1000, `${Math.round(afterTouch.rpm)} RPM`);

  // Keyboard alternate strokes.
  await page.evaluate(() => window.__bamboo.setRpm(0));
  await page.focus('body');
  for (let i = 0; i < 6; i++) await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight');
  await sleep(100);
  const afterKeys = await page.evaluate(() => window.__bamboo.getState());
  check('键盘搓动驱动转速', afterKeys.rpm > 80, `${Math.round(afterKeys.rpm)} RPM`);

  // Page visibility must stop the RAF loop and audio, then resume cleanly.
  const pauseResult = await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 300));
    const off = window.__bamboo.getState();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 400));
    const on = window.__bamboo.getState();
    delete document.hidden;
    return { off, on };
  });
  check('切到后台暂停渲染循环', pauseResult.off.loopActive === false, JSON.stringify({ loop: pauseResult.off.loopActive, audio: pauseResult.off.audioState }));
  check('切到后台暂停音频', pauseResult.off.audioState === 'suspended', pauseResult.off.audioState);
  check('返回前台恢复渲染', pauseResult.on.loopActive === true);

  // Help modal pauses the simulation as well.
  await page.click('#btn-help');
  await sleep(250);
  const modalPaused = await page.evaluate(() => window.__bamboo.getState().loopActive);
  await page.click('#help-modal [data-close]');
  await sleep(350);
  const modalResumed = await page.evaluate(() => window.__bamboo.getState().loopActive);
  check('打开帮助时暂停渲染', modalPaused === false);
  check('关闭帮助后恢复渲染', modalResumed === true);

  // Camera + MediaPipe pipeline, with an explicit independent switch.
  await page.click('#btn-camera');
  await sleep(500);
  const cameraBeforeSwitch = await page.evaluate(() => ({
    running: window.__bamboo.hand.running,
    status: document.getElementById('gesture-status').textContent,
  }));
  check('打开手势面板不会偷偷启动摄像头', cameraBeforeSwitch.running === false, cameraBeforeSwitch.status);
  await page.click('#btn-camera-start');
  await page.waitForFunction(() => window.__bamboo.hand.running, { timeout: 30000 }).catch(() => {});
  await sleep(700);
  const cameraState = await page.evaluate(() => ({
    running: window.__bamboo.hand.running,
    fps: window.__bamboo.hand._fps,
    badge: document.getElementById('gesture-badge').textContent,
    placeholderHidden: document.getElementById('gesture-placeholder').hidden,
    status: document.getElementById('gesture-status').textContent,
  }));
  check('MediaPipe Hands 摄像头管线启动', cameraState.running, JSON.stringify(cameraState));
  check('MediaPipe 读取限制 15fps', cameraState.fps === 15, `${cameraState.fps}fps`);
  check('摄像头预览不再遮挡', cameraState.placeholderHidden === true, cameraState.badge);
  await page.screenshot({ path: join(OUT, 'v05-camera.png') });

  // Stop real inference, then feed synthetic palm scrubbing frames.
  await page.evaluate(() => {
    const hand = window.__bamboo.hand;
    hand.stop();
    hand.running = true; // allow the synthetic result frames below
  });
  await sleep(200);
  await page.evaluate(() => window.__bamboo.setRpm(0));
  const gestureRpm = await page.evaluate(async () => {
    const hand = window.__bamboo.hand;
    const makeHand = (x, y) => {
      const pts = [];
      for (let i = 0; i < 21; i++) pts.push({ x, y, z: 0 });
      pts[0] = { x, y: y + 0.12, z: 0 };
      pts[5] = { x: x + 0.05, y: y - 0.06, z: 0 };
      pts[9] = { x: x + 0.01, y: y - 0.08, z: 0 };
      pts[13] = { x: x - 0.03, y: y - 0.07, z: 0 };
      pts[17] = { x: x - 0.07, y: y - 0.05, z: 0 };
      return pts;
    };
    hand.smoothPalm = null;
    hand.lastFrameAt = 0;
    hand.energy = 0;
    for (let i = 0; i < 36; i++) {
      const x = 0.5 + Math.sin(i * 1.35) * 0.22;
      hand._handleResults({ multiHandLandmarks: [makeHand(x, 0.52)] });
      await new Promise((r) => setTimeout(r, 34));
    }
    return window.__bamboo.physics.rpm;
  });
  check('摄像头手掌搓动转化为角速度', gestureRpm > 800, `${Math.round(gestureRpm)} RPM`);
  await page.evaluate(() => {
    document.getElementById('gesture-panel').hidden = true;
    window.__bamboo.hand.running = false;
    window.__bamboo.hand.stop();
  });

  // Persistence after reload.
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__bamboo, { timeout: 60000 });
  const persisted = await page.evaluate(() => window.__bamboo.getState().records);
  check('刷新后仍保留最佳成绩', persisted.bestTime > 0, JSON.stringify(persisted));

  // Mobile viewport and touch layout.
  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await mobile.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await mobile.waitForFunction(() => !!window.__bamboo, { timeout: 60000 });
  await mobile.evaluate(() => { localStorage.removeItem('bamboo-cicada-records-v1'); });
  await mobile.reload({ waitUntil: 'networkidle0' });
  await mobile.waitForFunction(() => !!window.__bamboo, { timeout: 60000 });
  await sleep(600);
  await mobile.tap('#btn-start');
  await sleep(1200);
  const mobileUi = await mobile.evaluate(() => {
    const score = getComputedStyle(document.querySelector('.challenge-score'));
    const shake = getComputedStyle(document.getElementById('btn-shake'));
    const speed = document.getElementById('speed-panel').getBoundingClientRect();
    return {
      scoreDisplay: score.display,
      shakeDisplay: shake.display,
      speedBottom: speed.bottom,
      viewport: window.innerHeight,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  check('手机端实时得分可见', mobileUi.scoreDisplay !== 'none', JSON.stringify(mobileUi));
  check('手机端布局无横向溢出', mobileUi.overflowX === false);
  await mobile.evaluate(() => window.__bamboo.setRpm(3600));
  await sleep(300);
  await mobile.screenshot({ path: join(OUT, 'v06-mobile.png') });

  // Device shake.
  await mobile.evaluate(() => { window.__bamboo.setRpm(0); });
  await mobile.evaluate(() => document.getElementById('btn-shake').click());
  await sleep(300);
  const shakeRpm = await mobile.evaluate(async () => {
    for (let i = 0; i < 4; i++) {
      const ev = new Event('devicemotion');
      Object.defineProperty(ev, 'acceleration', {
        value: { x: i % 2 ? -36 : 36, y: 8, z: 2 },
      });
      window.dispatchEvent(ev);
      await new Promise((r) => setTimeout(r, 220));
    }
    return window.__bamboo.physics.rpm;
  });
  check('摇一摇给竹翼加速', shakeRpm > 100, `${Math.round(shakeRpm)} RPM`);

  check('无页面脚本错误', browserErrors.length === 0, browserErrors.slice(0, 3).join(' | '));
} catch (error) {
  console.error(error);
  failures.push(`EXCEPTION: ${error.message}`);
  await page.screenshot({ path: join(OUT, 'v-error.png') }).catch(() => {});
} finally {
  const report = [
    '竹知了 3D · 自动验收报告',
    `时间：${new Date().toISOString()}`,
    '',
    ...results,
    '',
    failures.length ? `失败项：${failures.join(', ')}` : '全部通过',
    browserErrors.length ? `页面错误：\n${browserErrors.join('\n')}` : '',
  ].join('\n');
  await writeFile(join(OUT, 'verification-report.txt'), report, 'utf8');
  console.log('\n' + report);
  await browser.close();
  if (failures.length) process.exitCode = 1;
}
