const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const connectionSet = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

function loadMediaPipeScript() {
  if (window.Hands) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mediapipe-hands]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('MediaPipe Hands 加载失败')));
      return;
    }
    const script = document.createElement('script');
    script.src = './vendor/mediapipe/hands/hands.js';
    script.async = true;
    script.dataset.mediapipeHands = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('MediaPipe Hands 加载失败')), { once: true });
    document.head.appendChild(script);
  });
}

export class HandGestureController {
  constructor({ onRub, onStatus, onEnergy }) {
    this.onRub = onRub || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onEnergy = onEnergy || (() => {});
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.stream = null;
    this.hands = null;
    this.running = false;
    this.busy = false;
    this.timer = 0;
    this.lastFrameAt = 0;
    this.smoothPalm = null;
    this.rawPalm = null;
    this.lastVx = 0;
    this.lastDir = 0;
    this.lastReversalAt = 0;
    this.lastStatusAt = 0;
    this.energy = 0;
    this.handVisible = false;
    this.lastSeenAt = 0;
    this._fps = 15;
    this.results = null;
  }

  async start(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器或页面环境不支持摄像头，请通过 localhost / HTTPS 打开');
    }

    this.onStatus('正在加载 MediaPipe Hands…', 'loading');
    await loadMediaPipeScript();

    this.onStatus('正在请求摄像头权限…', 'loading');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15, max: 15 },
      },
      audio: false,
    });

    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    await new Promise((resolve) => {
      if (video.readyState >= 2) resolve();
      else video.addEventListener('loadeddata', resolve, { once: true });
    });

    this.hands = new window.Hands({
      locateFile: (file) => `./vendor/mediapipe/hands/${file}`,
    });
    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.62,
      minTrackingConfidence: 0.58,
    });
    this.hands.onResults((results) => this._handleResults(results));

    this.running = true;
    this.lastFrameAt = 0;
    this.lastStatusAt = 0;
    this.lastDir = 0;
    this.smoothPalm = null;
    this.energy = 0;
    this.onStatus('摄像头已就绪 · MediaPipe 以 15fps 运行', 'ready');
    this._scheduleNext();
    return true;
  }

  _scheduleNext() {
    if (!this.running) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(this._loop, 1000 / this._fps);
  }

  _loop = () => {
    this.timer = 0;
    if (!this.running || document.hidden) return;
    if (!this.busy && this.video?.readyState >= 2 && this.hands) {
      this.busy = true;
      this.hands.send({ image: this.video }).catch((error) => {
        console.warn('MediaPipe send failed', error);
        this.onStatus('手势识别暂时中断，正在重试…', 'error');
      }).finally(() => {
        this.busy = false;
      });
    }
    this._scheduleNext();
  };

  _handleResults(results) {
    if (!this.running || document.hidden) return;
    this.results = results;
    const landmarks = results.multiHandLandmarks || [];
    const now = performance.now();
    const dt = this.lastFrameAt ? clamp((now - this.lastFrameAt) / 1000, 0.016, 0.2) : 0.033;
    this.lastFrameAt = now;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (landmarks.length === 0) {
      if (this.handVisible || now - this.lastSeenAt > 700) {
        this.handVisible = false;
        this.smoothPalm = null;
        this.energy *= 0.7;
        this.onEnergy(this.energy);
        this.onStatus('寻找手掌…把手掌放进画面，左右搓动', 'searching');
      }
      return;
    }

    this.handVisible = true;
    this.lastSeenAt = now;
    const hand = this._pickPrimaryHand(landmarks);
    this._drawHands(landmarks);

    const palm = {
      x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
      y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
    };
    this.rawPalm = palm;

    if (!this.smoothPalm) {
      this.smoothPalm = { ...palm };
      this.onStatus('已识别手掌 · 左右快速搓动', 'live');
      return;
    }

    const prev = this.smoothPalm;
    const alpha = 0.48;
    const sx = prev.x + (palm.x - prev.x) * alpha;
    const sy = prev.y + (palm.y - prev.y) * alpha;
    const dx = sx - prev.x;
    const dy = sy - prev.y;
    const vx = dx / dt;
    const vy = dy / dt;
    const speed = Math.hypot(vx, vy);
    this.smoothPalm = { x: sx, y: sy };

    // Horizontal scrubbing carries the most energy; vertical hand travel adds a little.
    const scrubSpeed = Math.abs(vx) + Math.abs(vy) * 0.24;
    const activity = clamp(scrubSpeed / 1.2, 0, 1);
    this.energy += (activity - this.energy) * 0.32;
    this.onEnergy(this.energy);

    if (scrubSpeed > 0.13) {
      const path = Math.hypot(dx, dy);
      // Small continuous contribution from the moving palm, like air dragged by a hand.
      this.onRub(clamp(path * 0.16, 0, 0.022), Math.sign(vx) || 1, 1);
    }

    if (scrubSpeed > 0.19 && Math.abs(vx) > 0.1) {
      const dir = Math.sign(vx);
      if (this.lastDir && dir !== this.lastDir && now - this.lastReversalAt > 75) {
        const power = clamp(scrubSpeed / 1.2, 0.3, 1);
        this.onRub(0.06 + power * 0.13, dir, 1);
        this.lastReversalAt = now;
        this.onStatus('左右搓动中 · 已捕捉到搓动', 'live');
      }
      this.lastDir = dir;
    } else if (now - this.lastSeenAt > 200) {
      this.lastDir = 0;
    }

    if (now - this.lastStatusAt > 700) {
      this.lastStatusAt = now;
      if (this.energy > 0.22) this.onStatus('左右搓动中 · 竹翼正在加速', 'live');
      else this.onStatus('已识别手掌 · 左右快速搓动', 'live');
    }
  }

  _pickPrimaryHand(landmarks) {
    let best = landmarks[0];
    let bestScore = -1;
    for (const hand of landmarks) {
      let minX = 1;
      let maxX = 0;
      let minY = 1;
      let maxY = 0;
      for (const point of hand) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      const score = (maxX - minX) + (maxY - minY) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = hand;
      }
    }
    return best;
  }

  _drawHands(landmarks) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const hand of landmarks) {
      // Soft glow under the skeleton.
      ctx.strokeStyle = 'rgba(237, 190, 108, 0.18)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (const [a, b] of connectionSet) {
        ctx.moveTo(hand[a].x * w, hand[a].y * h);
        ctx.lineTo(hand[b].x * w, hand[b].y * h);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 231, 175, 0.88)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (const [a, b] of connectionSet) {
        ctx.moveTo(hand[a].x * w, hand[a].y * h);
        ctx.lineTo(hand[b].x * w, hand[b].y * h);
      }
      ctx.stroke();

      for (let i = 0; i < hand.length; i++) {
        const point = hand[i];
        const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
        ctx.beginPath();
        ctx.arc(point.x * w, point.y * h, tip ? 5.5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = tip ? '#f6d48e' : 'rgba(255, 243, 213, 0.9)';
        ctx.fill();
        if (tip) {
          ctx.beginPath();
          ctx.arc(point.x * w, point.y * h, 10, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(240, 190, 96, 0.16)';
          ctx.fill();
        }
      }

      // Palm halo.
      const mx = ((hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5) * w;
      const my = ((hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5) * h;
      const halo = ctx.createRadialGradient(mx, my, 0, mx, my, 60);
      halo.addColorStop(0, `rgba(244, 196, 107, ${0.1 + this.energy * 0.23})`);
      halo.addColorStop(1, 'rgba(244, 196, 107, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(mx, my, 60, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = 0;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    if (this.hands) {
      try { this.hands.close(); } catch (error) { /* noop */ }
      this.hands = null;
    }
    if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.smoothPalm = null;
    this.energy = 0;
    this.onEnergy(0);
  }
}
