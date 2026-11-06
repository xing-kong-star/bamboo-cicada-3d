import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const PERF_DPR_CAP = 1.0;
const QUALITY_DPR_CAP = 1.5;
const PERF_PIXELS = 1280 * 720;
const QUALITY_PIXELS = 1920 * 1080;
const SOFTWARE_PIXELS = 960 * 540;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function makeBambooTexture({ base = '#b88746', light = '#d7ae67', dark = '#6e4b25', nodeCount = 5 } = {}) {
  const random = mulberry32(base.length * 719 + nodeCount * 131);
  return canvasTexture(768, 768, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, dark);
    gradient.addColorStop(0.12, base);
    gradient.addColorStop(0.48, light);
    gradient.addColorStop(0.62, base);
    gradient.addColorStop(0.9, '#96703a');
    gradient.addColorStop(1, dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Longitudinal fibres.
    for (let i = 0; i < 650; i++) {
      const x = random() * w;
      const y = random() * h;
      const length = 35 + random() * 250;
      ctx.strokeStyle = random() > 0.46
        ? `rgba(242, 209, 145, ${0.025 + random() * 0.11})`
        : `rgba(70, 43, 18, ${0.02 + random() * 0.09})`;
      ctx.lineWidth = 0.45 + random() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 2, y + length * 0.3, x - 2, y + length * 0.68, x + 1, y + length);
      ctx.stroke();
    }

    // Pores and sun spots.
    for (let i = 0; i < 330; i++) {
      const x = random() * w;
      const y = random() * h;
      ctx.fillStyle = `rgba(58, 36, 14, ${0.025 + random() * 0.11})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 0.5 + random() * 2.3, 3 + random() * 13, 0, 0, TAU);
      ctx.fill();
    }

    // Nodes: a dark collar with a pale ridge just above it.
    const nodeGap = h / nodeCount;
    for (let n = 0; n < nodeCount; n++) {
      const y = nodeGap * n + nodeGap * (0.2 + random() * 0.18);
      const nodeH = 7 + random() * 5;
      const nodeGrad = ctx.createLinearGradient(0, y - 9, 0, y + 16);
      nodeGrad.addColorStop(0, 'rgba(244, 216, 158, 0.0)');
      nodeGrad.addColorStop(0.32, 'rgba(244, 216, 158, 0.26)');
      nodeGrad.addColorStop(0.48, 'rgba(77, 49, 22, 0.62)');
      nodeGrad.addColorStop(0.58, 'rgba(49, 31, 14, 0.4)');
      nodeGrad.addColorStop(0.78, 'rgba(240, 205, 142, 0.2)');
      nodeGrad.addColorStop(1, 'rgba(244, 216, 158, 0.0)');
      ctx.fillStyle = nodeGrad;
      ctx.fillRect(0, y - 9, w, nodeH + 20);

      ctx.strokeStyle = 'rgba(47, 29, 12, 0.42)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y + nodeH * 0.58);
      for (let x = 0; x <= w; x += 8) {
        ctx.lineTo(x, y + nodeH * 0.58 + Math.sin(x * 0.03 + n) * 1.2);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(252, 227, 175, 0.2)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, y + nodeH * 0.3);
      for (let x = 0; x <= w; x += 8) {
        ctx.lineTo(x, y + nodeH * 0.3 + Math.sin(x * 0.025 + n + 2) * 0.9);
      }
      ctx.stroke();
    }

    // Fine grain noise.
    const image = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < image.data.length; i += 4) {
      const noise = (random() - 0.5) * 13;
      image.data[i] = clamp(image.data[i] + noise, 0, 255);
      image.data[i + 1] = clamp(image.data[i + 1] + noise, 0, 255);
      image.data[i + 2] = clamp(image.data[i + 2] + noise, 0, 255);
    }
    ctx.putImageData(image, 0, 0);
  });
}

function makeGrassTexture() {
  const random = mulberry32(8102);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#4c6337';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = random() * w;
      const y = random() * h;
      const len = 2 + random() * 10;
      ctx.strokeStyle = random() > 0.48
        ? `rgba(139, 163, 97, ${0.08 + random() * 0.22})`
        : `rgba(37, 58, 31, ${0.08 + random() * 0.24})`;
      ctx.lineWidth = 0.5 + random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 4, y - len);
      ctx.stroke();
    }
  });
}

function makeMatTexture() {
  const random = mulberry32(1912);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#aa7c42';
    ctx.fillRect(0, 0, w, h);
    const cols = 28;
    const rows = 28;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = (x / cols) * w;
        const py = (y / rows) * h;
        const light = (x + y) % 2 === 0;
        ctx.fillStyle = light ? 'rgba(222, 178, 108, 0.18)' : 'rgba(72, 45, 21, 0.12)';
        ctx.fillRect(px + 1, py + 1, w / cols - 2, h / rows - 2);
      }
    }
    for (let i = 0; i < 120; i++) {
      ctx.strokeStyle = `rgba(64, 40, 17, ${0.05 + random() * 0.14})`;
      ctx.lineWidth = 0.6 + random();
      ctx.beginPath();
      const y = random() * h;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (random() - 0.5) * 8);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(93, 59, 27, 0.4)';
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, w - 12, h - 12);
  });
}

function makeGlowTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255, 248, 214, 1)');
    grad.addColorStop(0.2, 'rgba(250, 215, 145, 0.76)');
    grad.addColorStop(0.52, 'rgba(235, 172, 80, 0.24)');
    grad.addColorStop(1, 'rgba(220, 145, 55, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
}

function makeCloudTexture() {
  const random = mulberry32(644);
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = w * (0.16 + random() * 0.68);
      const y = h * (0.36 + random() * 0.28);
      const r = 24 + random() * 68;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255, 241, 208, 0.15)');
      grad.addColorStop(0.55, 'rgba(255, 235, 198, 0.06)');
      grad.addColorStop(1, 'rgba(255, 235, 198, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  });
}

function makeLeafTexture() {
  const random = mulberry32(3721);
  return canvasTexture(128, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#a2b96f');
    grad.addColorStop(0.45, '#7f9c55');
    grad.addColorStop(1, '#5d7c43');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Central vein.
    ctx.strokeStyle = 'rgba(221, 233, 170, 0.38)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, 4);
    ctx.lineTo(w / 2, h - 4);
    ctx.stroke();

    // Side veins.
    for (let i = 1; i < 16; i++) {
      const y = (i / 16) * h;
      for (const side of [-1, 1]) {
        ctx.strokeStyle = `rgba(218, 232, 166, ${0.1 + random() * 0.12})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(w / 2, y);
        ctx.quadraticCurveTo(w / 2 + side * 24, y + 8, w / 2 + side * 46, y + 22);
        ctx.stroke();
      }
    }

    // Subtle mottling.
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `rgba(56, 82, 40, ${0.03 + random() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(random() * w, random() * h, 1 + random() * 4, 2 + random() * 10, random() * TAU, 0, TAU);
      ctx.fill();
    }
  });
}

function makeBladeTexture() {
  const random = mulberry32(6157);
  return canvasTexture(1024, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#8d602d');
    grad.addColorStop(0.16, '#c28f4a');
    grad.addColorStop(0.43, '#ecc87f');
    grad.addColorStop(0.62, '#d6aa5e');
    grad.addColorStop(0.9, '#a57436');
    grad.addColorStop(1, '#6e4a24');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // A visible central cane vein and radiating fibre lines.
    ctx.strokeStyle = 'rgba(93, 59, 24, 0.48)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.bezierCurveTo(w * 0.34, h * 0.46, w * 0.68, h * 0.54, w, h * 0.5);
    ctx.stroke();

    for (let i = 0; i < 280; i++) {
      const y = random() * h;
      const x = random() * w;
      const len = 40 + random() * 360;
      ctx.strokeStyle = random() > 0.52
        ? `rgba(255, 231, 173, ${0.04 + random() * 0.18})`
        : `rgba(89, 56, 24, ${0.025 + random() * 0.12})`;
      ctx.lineWidth = 0.5 + random() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + len * 0.3, y + (random() - 0.5) * 4, x + len * 0.7, y + (random() - 0.5) * 4, x + len, y);
      ctx.stroke();
    }

    // Dark, weather-worn leading edge.
    ctx.fillStyle = 'rgba(75, 44, 18, 0.36)';
    ctx.fillRect(0, 0, w, 5);
    ctx.fillStyle = 'rgba(255, 238, 190, 0.16)';
    ctx.fillRect(0, 6, w, 3);

    const image = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = (random() - 0.5) * 11;
      image.data[i] = clamp(image.data[i] + n, 0, 255);
      image.data[i + 1] = clamp(image.data[i + 1] + n, 0, 255);
      image.data[i + 2] = clamp(image.data[i + 2] + n, 0, 255);
    }
    ctx.putImageData(image, 0, 0);
  });
}

function makeSoftShadowTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(18, 30, 16, 0.46)');
    grad.addColorStop(0.52, 'rgba(18, 30, 16, 0.18)');
    grad.addColorStop(1, 'rgba(18, 30, 16, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
}

function makeLeafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.07, 0.08, 0.28, 0.34, 0.34, 0.6);
  shape.bezierCurveTo(0.24, 0.72, 0.08, 0.82, 0, 0.86);
  shape.bezierCurveTo(-0.08, 0.82, -0.24, 0.72, -0.34, 0.6);
  shape.bezierCurveTo(-0.28, 0.34, -0.07, 0.08, 0, 0);
  const geo = new THREE.ShapeGeometry(shape, 6);
  geo.translate(0, -0.35, 0);
  return geo;
}

export class BambooScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xd7dab4, 15, 39);
    this.camera = new THREE.PerspectiveCamera(44, 1, 0.1, 80);
    this.camera.position.set(3.4, 5.0, 6.4);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = false;

    const gl = this.renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuRenderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    this.softwareGPU = /swiftshader|llvmpipe|software|basic render|warp/i.test(this.gpuRenderer);

    this.qualityMode = 'performance';
    this.usePost = false;
    this.ghostCount = isCoarsePointer ? 6 : 8;
    this.ghosts = [];
    this.clockTime = 0;
    this.introMode = true;
    this.speedRatio = 0;
    this.currentAngle = 0;
    this.rubPulse = 0;
    this.lowPower = false;
    this.atmosAccumulator = 0;
    this.renderedFrames = 0;
    this.clouds = [];
    this.dust = null;
    this.sparks = null;
    this.sparkData = [];
    this.tipSprites = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pickMeshes = [];
    this.hovered = false;

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.toyRoot = new THREE.Group();
    this.root.add(this.toyRoot);

    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildForest();
    this._buildStand();
    this._buildToy();
    this._buildAtmosphere();
    this._setupControls();
    this._setupComposer();

    this.resize();
  }

  _setupComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.afterimagePass = new AfterimagePass(0);
    this.outputPass = new OutputPass();
    this.afterimagePass.damp = 0;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.afterimagePass);
    this.composer.addPass(this.outputPass);
  }

  _computePixelRatio(width, height) {
    const deviceRatio = window.devicePixelRatio || 1;
    const quality = this.qualityMode === 'quality' && !this.lowPower && !this.softwareGPU;
    const cap = quality ? QUALITY_DPR_CAP : PERF_DPR_CAP;
    const budget = this.softwareGPU
      ? SOFTWARE_PIXELS
      : (quality ? QUALITY_PIXELS : PERF_PIXELS);
    this.maxRenderPixels = budget;
    const base = Math.min(deviceRatio, cap);
    const pixelBudget = Math.sqrt(budget / Math.max(1, width * height));
    return Math.max(0.25, Math.min(base, pixelBudget));
  }

  _buildSky() {
    const skyGeo = new THREE.SphereGeometry(52, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x7098ae) },
        uMid: { value: new THREE.Color(0xe5d2ab) },
        uLow: { value: new THREE.Color(0xf4d29b) },
        uSunDir: { value: new THREE.Vector3(-0.42, 0.38, -0.82).normalize() },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = normalize(world.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorld;
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uLow;
        uniform vec3 uSunDir;
        void main() {
          float h = clamp(vWorld.y * 0.9 + 0.18, 0.0, 1.0);
          vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.28, h));
          col = mix(col, uTop, smoothstep(0.28, 0.9, h));
          float sun = max(dot(vWorld, uSunDir), 0.0);
          col += vec3(1.0, 0.72, 0.38) * pow(sun, 34.0) * 0.42;
          col += vec3(1.0, 0.82, 0.52) * pow(sun, 5.0) * 0.04;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    const glow = makeGlowTexture();
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow,
      color: 0xffe3a8,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    sun.position.set(-11, 10.5, -27);
    sun.scale.set(7.2, 7.2, 1);
    this.scene.add(sun);

    const sunCore = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 48),
      new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.9, fog: false })
    );
    sunCore.position.set(-11, 10.5, -26.9);
    this.scene.add(sunCore);

    const cloudTex = makeCloudTexture();
    const random = mulberry32(443);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.SpriteMaterial({
        map: cloudTex,
        color: 0xffeed0,
        transparent: true,
        opacity: 0.18 + random() * 0.12,
        depthWrite: false,
        fog: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(-14 + random() * 28, 8 + random() * 6, -19 - random() * 8);
      sprite.scale.set(8 + random() * 7, 3 + random() * 2.5, 1);
      this.clouds.push({ sprite, speed: 0.008 + random() * 0.016, baseX: sprite.position.x });
      this.scene.add(sprite);
    }
  }

  _buildLights() {
    // Two-light setup only. Every extra punctual light increases the fragment
    // cost of the full-screen ground and foliage, which matters on iGPUs.
    const hemi = new THREE.HemisphereLight(0xffe7bd, 0x4a5d38, 2.45);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffd39a, 3.5);
    sun.position.set(-5.5, 8.5, 5.5);
    sun.castShadow = false;
    this.scene.add(sun);
  }

  _buildGround() {
    const grassTex = makeGrassTexture();
    grassTex.repeat.set(16, 16);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80, 1, 1),
      new THREE.MeshStandardMaterial({
        map: grassTex,
        color: 0xc7d3a3,
        roughness: 1,
        metalness: 0,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.root.add(ground);

    // A soft patch of dry earth under the mat.
    const earth = new THREE.Mesh(
      new THREE.CircleGeometry(2.3, 48),
      new THREE.MeshStandardMaterial({
        color: 0x8b744b,
        roughness: 1,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
    );
    earth.rotation.x = -Math.PI / 2;
    earth.position.y = -0.03;
    earth.receiveShadow = true;
    this.root.add(earth);

    const mountainMat1 = new THREE.MeshBasicMaterial({
      color: 0x718777,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      fog: true,
    });
    const mountainMat2 = new THREE.MeshBasicMaterial({
      color: 0x516e60,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: true,
    });
    const shape = new THREE.Shape();
    shape.moveTo(-30, 0);
    shape.lineTo(-30, 2.2);
    shape.lineTo(-22, 4.6);
    shape.lineTo(-15, 2.8);
    shape.lineTo(-8, 6.5);
    shape.lineTo(-1, 3.5);
    shape.lineTo(7, 7.2);
    shape.lineTo(15, 3.8);
    shape.lineTo(23, 5.1);
    shape.lineTo(30, 2.2);
    shape.lineTo(30, 0);
    shape.closePath();
    const geo1 = new THREE.ShapeGeometry(shape);
    const mountains1 = new THREE.Mesh(geo1, mountainMat1);
    mountains1.position.set(0, 0, -24);
    mountains1.scale.set(1.7, 1.45, 1);
    this.root.add(mountains1);
    const mountains2 = new THREE.Mesh(geo1, mountainMat2);
    mountains2.position.set(2, 0, -18.5);
    mountains2.scale.set(1.2, 0.95, 1);
    this.root.add(mountains2);
  }

  _buildForest() {
    const random = mulberry32(50911);
    const bambooTex = makeBambooTexture({ base: '#7f9b59', light: '#b3c786', dark: '#45633a', nodeCount: 7 });
    bambooTex.repeat.set(1, 2.4);
    const bambooMat = new THREE.MeshStandardMaterial({
      map: bambooTex,
      color: 0xd2dfac,
      roughness: 0.78,
      metalness: 0,
    });
    const nodeMat = new THREE.MeshStandardMaterial({ color: 0x516b3c, roughness: 0.88 });
    const leafTex = makeLeafTexture();
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTex,
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const grouping = new THREE.Group();
    this.root.add(grouping);
    const leafGeo = makeLeafGeometry();
    const leafCount = isCoarsePointer ? 260 : 390;
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, leafCount);
    leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    leaves.frustumCulled = false;
    grouping.add(leaves);
    this.leafMesh = leaves;
    const dummy = new THREE.Object3D();
    const leafColor = new THREE.Color();
    const leafPalette = [0xb7c982, 0x9eb56e, 0x86a35f, 0xc5d08e, 0x748f53, 0xaabf76];

    const stalkCount = isCoarsePointer ? 15 : 21;
    const stalkPositions = [];
    const stalkRecords = [];
    const nodeRecords = [];
    let leafIndex = 0;
    for (let i = 0; i < stalkCount; i++) {
      let x = 0;
      let z = 0;
      let radius = 0;
      for (let attempt = 0; attempt < 36; attempt++) {
        const angle = random() * TAU;
        radius = 3.5 + random() * 8.8;
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        // Leave a clear window in front of the toy for the blade and HUD.
        const blocksCenter = z > 0.2 && z < 10 && Math.abs(x) < 4.15;
        const tooClose = Math.hypot(x, z) < 3.5;
        if (!blocksCenter && !tooClose) break;
      }
      const height = 5.8 + random() * 6.5;
      const r = 0.055 + random() * 0.115;
      stalkPositions.push({ x, z, radius: r });
      stalkRecords.push({ x, z, height, r, rot: random() * TAU });

      const nodeCount = 4 + Math.floor(random() * 4);
      for (let n = 0; n < nodeCount; n++) {
        nodeRecords.push({
          x,
          z,
          y: (height / (nodeCount + 1)) * (n + 1) + (random() - 0.5) * 0.3,
          r,
          rot: random() * TAU,
        });
      }

      const clusterCount = 3 + Math.floor(random() * 4);
      for (let c = 0; c < clusterCount && leafIndex < leafCount; c++) {
        // Keep the canopy above the rotor so the spinning wing never
        // disappears into a curtain of leaves.
        const baseY = Math.max(4.45, height * (0.66 + random() * 0.3));
        const branches = 3 + Math.floor(random() * 4);
        for (let b = 0; b < branches && leafIndex < leafCount; b++) {
          const leafAngle = random() * TAU;
          const reach = 0.16 + random() * 0.46;
          const lx = Math.cos(leafAngle) * reach;
          const lz = Math.sin(leafAngle) * reach;
          dummy.position.set(x + lx, baseY + (random() - 0.5) * 0.55, z + lz);
          dummy.rotation.set(
            -0.7 + random() * 1.35,
            leafAngle + (random() - 0.5) * 1.2,
            -0.9 + random() * 1.8
          );
          const s = 0.22 + random() * 0.33;
          dummy.scale.set(s, s * (0.8 + random() * 0.5), s);
          dummy.updateMatrix();
          leaves.setMatrixAt(leafIndex, dummy.matrix);
          leafColor.setHex(leafPalette[Math.floor(random() * leafPalette.length)]);
          leaves.setColorAt(leafIndex, leafColor);
          leafIndex++;
        }
      }
    }
    for (; leafIndex < leafCount; leafIndex++) {
      dummy.position.set(0, -10, 0);
      dummy.scale.setScalar(0.001);
      dummy.updateMatrix();
      leaves.setMatrixAt(leafIndex, dummy.matrix);
      leafColor.setHex(leafPalette[0]);
      leaves.setColorAt(leafIndex, leafColor);
    }
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;

    // All 21 bamboo stalks and their nodes are two draw calls in total.
    const stalkMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.8, 1, 1, 8, 1, false),
      bambooMat,
      stalkRecords.length
    );
    const nodeMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 8, 1, false),
      nodeMat,
      nodeRecords.length
    );
    const instanceDummy = new THREE.Object3D();
    for (let i = 0; i < stalkRecords.length; i++) {
      const s = stalkRecords[i];
      instanceDummy.position.set(s.x, s.height / 2, s.z);
      instanceDummy.rotation.set(0, s.rot, 0);
      instanceDummy.scale.set(s.r, s.height, s.r);
      instanceDummy.updateMatrix();
      stalkMesh.setMatrixAt(i, instanceDummy.matrix);
    }
    for (let i = 0; i < nodeRecords.length; i++) {
      const n = nodeRecords[i];
      instanceDummy.position.set(n.x, n.y, n.z);
      instanceDummy.rotation.set(0, n.rot, 0);
      instanceDummy.scale.set(n.r * 1.16, 0.026, n.r * 1.16);
      instanceDummy.updateMatrix();
      nodeMesh.setMatrixAt(i, instanceDummy.matrix);
    }
    stalkMesh.instanceMatrix.needsUpdate = true;
    nodeMesh.instanceMatrix.needsUpdate = true;
    stalkMesh.receiveShadow = true;
    grouping.add(stalkMesh, nodeMesh);

    // A few large leaves at the outer edges of the frame add depth without
    // covering the rotor in the middle of the screen.
    const foreground = new THREE.Group();
    this.root.add(foreground);
    const fgLeaves = [
      [-6.0, 6.4, 4.2, -0.4, 0.5, 1.0],
      [-5.4, 5.4, 4.9, 0.2, 0.8, 0.78],
      [6.1, 6.1, 3.6, -0.5, -0.7, 0.92],
      [5.5, 6.9, 4.4, 0.2, -0.4, 0.7],
    ];
    for (const [x, y, z, rx, ry, s] of fgLeaves) {
      const mesh = new THREE.Mesh(leafGeo, leafMat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, 2.3);
      mesh.scale.setScalar(s);
      foreground.add(mesh);
    }

    // Grounded contact shadows for bamboo stalks.
    const shadowTex = makeSoftShadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const shadowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), shadowMat, stalkPositions.length);
    const shadowDummy = new THREE.Object3D();
    for (let i = 0; i < stalkPositions.length; i++) {
      const p = stalkPositions[i];
      shadowDummy.position.set(p.x, 0.006, p.z);
      shadowDummy.rotation.x = -Math.PI / 2;
      const s = 0.55 + p.radius * 3.2;
      shadowDummy.scale.set(s, s, 1);
      shadowDummy.updateMatrix();
      shadowMesh.setMatrixAt(i, shadowDummy.matrix);
    }
    shadowMesh.instanceMatrix.needsUpdate = true;
    this.root.add(shadowMesh);

    // Small grass tufts and stones break up the empty ground.
    const tuftClusters = isCoarsePointer ? 16 : 28;
    const tuftCount = tuftClusters * 4;
    const tufts = new THREE.InstancedMesh(leafGeo, leafMat, tuftCount);
    const tuftDummy = new THREE.Object3D();
    let tuftIndex = 0;
    for (let c = 0; c < tuftClusters; c++) {
      const angle = random() * TAU;
      const radius = 1.55 + random() * 4.5;
      const cx = Math.cos(angle) * radius;
      const cz = Math.sin(angle) * radius;
      for (let i = 0; i < 4; i++) {
        tuftDummy.position.set(cx + (random() - 0.5) * 0.13, 0.02, cz + (random() - 0.5) * 0.13);
        tuftDummy.rotation.set(
          -0.24 + random() * 0.48,
          random() * TAU,
          -0.4 + random() * 0.8
        );
        const s = 0.08 + random() * 0.1;
        tuftDummy.scale.set(s, s * (0.8 + random() * 0.9), s);
        tuftDummy.updateMatrix();
        tufts.setMatrixAt(tuftIndex, tuftDummy.matrix);
        leafColor.setHex(leafPalette[Math.floor(random() * leafPalette.length)]);
        tufts.setColorAt(tuftIndex, leafColor);
        tuftIndex++;
      }
    }
    tufts.instanceMatrix.needsUpdate = true;
    if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
    this.root.add(tufts);

    // A loose canopy layer behind the toy. These leaves read as high bamboo
    // branches and keep the upper background from feeling empty.
    const canopyClusters = isCoarsePointer ? 18 : 30;
    const canopyCount = canopyClusters * 5;
    const canopy = new THREE.InstancedMesh(leafGeo, leafMat, canopyCount);
    const canopyDummy = new THREE.Object3D();
    let canopyIndex = 0;
    for (let c = 0; c < canopyClusters; c++) {
      let cx = 0;
      let cz = 0;
      for (let attempt = 0; attempt < 20; attempt++) {
        const a = random() * TAU;
        const radius = 4.2 + random() * 7;
        cx = Math.cos(a) * radius;
        cz = Math.sin(a) * radius;
        if (!(cz > -0.5 && cz < 10 && Math.abs(cx) < 4.6)) break;
      }
      const cy = 4.7 + random() * 3.9;
      for (let b = 0; b < 5; b++) {
        canopyDummy.position.set(
          cx + (random() - 0.5) * 1.2,
          cy + (random() - 0.5) * 0.9,
          cz + (random() - 0.5) * 1.2
        );
        canopyDummy.rotation.set(
          -0.8 + random() * 1.6,
          random() * TAU,
          -1.1 + random() * 2.2
        );
        const s = 0.22 + random() * 0.34;
        canopyDummy.scale.set(s, s * (0.8 + random() * 0.5), s);
        canopyDummy.updateMatrix();
        canopy.setMatrixAt(canopyIndex, canopyDummy.matrix);
        leafColor.setHex(leafPalette[Math.floor(random() * leafPalette.length)]);
        canopy.setColorAt(canopyIndex, leafColor);
        canopyIndex++;
      }
    }
    canopy.instanceMatrix.needsUpdate = true;
    if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
    this.root.add(canopy);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x80806b, roughness: 0.96, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const angle = random() * TAU;
      const radius = 1.8 + random() * 3.8;
      const size = 0.1 + random() * 0.24;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), stoneMat);
      stone.position.set(Math.cos(angle) * radius, size * 0.45, Math.sin(angle) * radius);
      stone.scale.set(1 + random() * 0.7, 0.55 + random() * 0.3, 0.8 + random() * 0.5);
      stone.rotation.set(random(), random() * TAU, random());
      stone.castShadow = true;
      stone.receiveShadow = true;
      this.root.add(stone);
    }

    // A hazy second layer of bamboo far behind the main grove gives the
    // scene depth without adding much geometry.
    const distantMat = new THREE.MeshStandardMaterial({
      color: 0xaaba8f,
      roughness: 1,
      transparent: true,
      opacity: 0.52,
    });
    const distantMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.9, 1, 1, 5),
      distantMat,
      18
    );
    const distantDummy = new THREE.Object3D();
    for (let i = 0; i < 18; i++) {
      const angle = random() * TAU;
      const radius = 14 + random() * 8;
      const height = 8 + random() * 8;
      const r = 0.035 + random() * 0.07;
      distantDummy.position.set(Math.cos(angle) * radius, height / 2 - 0.2, Math.sin(angle) * radius);
      distantDummy.scale.set(r, height, r);
      distantDummy.updateMatrix();
      distantMesh.setMatrixAt(i, distantDummy.matrix);
    }
    distantMesh.instanceMatrix.needsUpdate = true;
    this.root.add(distantMesh);

  }

  _buildStand() {
    const matTex = makeMatTexture();
    matTex.repeat.set(2, 2);
    const mat = new THREE.Mesh(
      new THREE.CylinderGeometry(1.16, 1.2, 0.11, 64),
      new THREE.MeshStandardMaterial({
        map: matTex,
        color: 0xc5a777,
        roughness: 0.9,
        metalness: 0,
      })
    );
    mat.position.y = 0.06;
    mat.castShadow = true;
    mat.receiveShadow = true;
    this.root.add(mat);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.19, 0.035, 8, 80),
      new THREE.MeshStandardMaterial({ color: 0x6d4a27, roughness: 0.85 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.12;
    rim.castShadow = true;
    this.root.add(rim);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.23, 0.18, 24),
      new THREE.MeshStandardMaterial({ color: 0x55402b, roughness: 0.78 })
    );
    base.position.y = 0.2;
    base.castShadow = true;
    this.root.add(base);

    const bearing = new THREE.Mesh(
      new THREE.TorusGeometry(0.12, 0.022, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0xc69b58, roughness: 0.45, metalness: 0.35 })
    );
    bearing.rotation.x = Math.PI / 2;
    bearing.position.y = 0.3;
    bearing.castShadow = true;
    this.root.add(bearing);
  }

  _buildToy() {
    const bambooTex = makeBambooTexture({ base: '#bd8a47', light: '#e0b56b', dark: '#704a26', nodeCount: 6 });
    bambooTex.repeat.set(1, 4.1);
    const bambooMat = new THREE.MeshStandardMaterial({
      map: bambooTex,
      color: 0xe0bb7b,
      roughness: 0.62,
      metalness: 0,
      emissive: 0x1a1106,
      emissiveIntensity: 0.12,
    });

    const bladeTex = makeBladeTexture();
    this.bladeMaterial = new THREE.MeshStandardMaterial({
      map: bladeTex,
      color: 0xf1d79c,
      roughness: 0.54,
      metalness: 0,
      emissive: 0x2b1b09,
      emissiveIntensity: 0.18,
      side: THREE.DoubleSide,
    });

    const darkBamboo = new THREE.MeshStandardMaterial({ color: 0x593a1d, roughness: 0.8 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0x9e3424, roughness: 0.58 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd6aa58, roughness: 0.35, metalness: 0.22 });

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 3.46, 12, 3), bambooMat);
    shaft.position.y = 2.02;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    this.toyRoot.add(shaft);

    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.052, 0.09, 12), bambooMat);
    topCap.position.y = 3.79;
    topCap.castShadow = true;
    this.toyRoot.add(topCap);

    // Thread-wrapped grip.
    for (let i = 0; i < 6; i++) {
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.057, 0.009, 6, 18), redMat);
      wrap.rotation.x = Math.PI / 2;
      wrap.position.y = 0.74 + i * 0.033;
      this.toyRoot.add(wrap);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), redMat);
    knot.position.set(0.075, 0.9, 0.02);
    knot.castShadow = true;
    this.toyRoot.add(knot);

    // Rotor pivot.
    this.rotorPivot = new THREE.Group();
    this.rotorPivot.position.y = 3.46;
    this.toyRoot.add(this.rotorPivot);

    this.bladeTilt = new THREE.Group();
    this.rotorPivot.add(this.bladeTilt);

    const spin = new THREE.Group();
    this.spinGroup = spin;
    this.bladeTilt.add(spin);

    const wingGeo = this._makeWingGeometry();
    const wingA = new THREE.Mesh(wingGeo, this.bladeMaterial);
    wingA.castShadow = true;
    wingA.receiveShadow = true;
    spin.add(wingA);

    const wingB = new THREE.Mesh(wingGeo, this.bladeMaterial);
    wingB.rotation.y = Math.PI;
    wingB.castShadow = true;
    wingB.receiveShadow = true;
    spin.add(wingB);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.13, 18), bambooMat);
    hub.castShadow = true;
    spin.add(hub);

    const hubBand = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.016, 6, 24), redMat);
    hubBand.rotation.x = Math.PI / 2;
    hubBand.position.y = 0.03;
    spin.add(hubBand);

    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.2, 8), goldMat);
    pin.position.y = 0.15;
    pin.castShadow = true;
    spin.add(pin);

    // Small tassel under the rotor. Centrifugal force makes it flare out.
    const tassel = new THREE.Group();
    tassel.position.y = -0.08;
    this.tasselPivot = tassel;
    spin.add(tassel);
    const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 5), redMat);
    thread.position.y = -0.17;
    tassel.add(thread);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 7), goldMat);
    bead.position.y = -0.36;
    tassel.add(bead);
    for (let i = 0; i < 7; i++) {
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.002, 0.22, 3), redMat);
      const a = (i / 7) * TAU;
      strand.position.set(Math.cos(a) * 0.018, -0.49, Math.sin(a) * 0.018);
      strand.rotation.z = Math.cos(a) * 0.16;
      strand.rotation.x = Math.sin(a) * 0.16;
      tassel.add(strand);
    }

    // Performance mode uses a small fixed set of GPU blade copies. This is
    // much cheaper than a full-screen postprocessing chain and still gives a
    // clear trail fan. Quality mode hides these and uses AfterimagePass.
    for (let i = 0; i < this.ghostCount; i++) {
      const group = new THREE.Group();
      const material = new THREE.MeshBasicMaterial({
        color: 0xf2c878,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      group.add(new THREE.Mesh(wingGeo, material));
      const opposite = new THREE.Mesh(wingGeo, material);
      opposite.rotation.y = Math.PI;
      group.add(opposite);
      group.visible = false;
      group.renderOrder = 3;
      this.bladeTilt.add(group);
      this.ghosts.push({ group, material, index: i });
    }

    // Diffuse swept-disc glow remains as a lightweight accent.
    const ringMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uSpeed: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xffd889) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uSpeed;
        uniform float uTime;
        uniform vec3 uColor;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0 || r < 0.03) discard;
          float a = atan(p.y, p.x);
          float streak = pow(0.5 + 0.5 * sin(a * 23.0 + r * 9.0 - uTime * 5.2), 6.0);
          float fine = 0.5 + 0.5 * sin(a * 71.0 - uTime * 11.0);
          float ring = smoothstep(0.1, 0.5, r) * smoothstep(1.0, 0.68, r);
          float alpha = pow(uSpeed, 1.65) * ring * (0.022 + 0.095 * streak + 0.022 * fine * streak);
          vec3 col = mix(uColor, vec3(1.0, 0.98, 0.86), streak * 0.55);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.ringGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), ringMat);
    this.ringGlow.rotation.x = -Math.PI / 2;
    this.ringGlow.position.y = 0.01;
    this.ringGlow.renderOrder = 2;
    this.bladeTilt.add(this.ringGlow);

    // Thin luminous orbit lines make the rotor diameter readable even when
    // the wing itself is nearly edge-on.
    this.haloRings = [];
    for (const [radius, width, strength] of [[1.56, 0.005, 0.08], [1.4, 0.003, 0.03]]) {
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xffd58d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Mesh(new THREE.TorusGeometry(radius, width, 4, 96), haloMat);
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.018;
      halo.renderOrder = 4;
      this.bladeTilt.add(halo);
      this.haloRings.push({ mesh: halo, strength });
    }

    const tipGlowTex = makeGlowTexture();
    for (const side of [-1, 1]) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tipGlowTex,
        color: 0xffd27d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      sprite.position.set(side * 1.55, 0.015, 0);
      sprite.scale.set(0.92, 0.92, 1);
      this.spinGroup.add(sprite);
      this.tipSprites.push(sprite);
    }

    // Invisible broad hit volume makes the slender toy easy to grab.
    const hidden = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const shaftHit = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 3.6, 8), hidden);
    shaftHit.position.y = 2.0;
    this.toyRoot.add(shaftHit);
    this.pickMeshes.push(shaftHit);
    const bladeHit = new THREE.Mesh(new THREE.SphereGeometry(1.62, 12, 8), hidden);
    bladeHit.scale.y = 0.34;
    bladeHit.position.y = 3.46;
    this.toyRoot.add(bladeHit);
    this.pickMeshes.push(bladeHit);

    this._buildSparks();
  }

  _makeWingGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(0.1, -0.11);
    shape.bezierCurveTo(0.44, -0.19, 1.05, -0.22, 1.42, -0.09);
    shape.quadraticCurveTo(1.58, -0.045, 1.58, 0.01);
    shape.quadraticCurveTo(1.56, 0.085, 1.38, 0.115);
    shape.bezierCurveTo(1.03, 0.19, 0.43, 0.17, 0.1, 0.1);
    shape.quadraticCurveTo(0.03, 0.02, 0.1, -0.11);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.032,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
      curveSegments: 18,
      steps: 1,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.016, 0);
    geo.computeBoundingBox();
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const box = geo.boundingBox;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      uv.setXY(
        i,
        (x - box.min.x) / (box.max.x - box.min.x),
        (z - box.min.z) / (box.max.z - box.min.z)
      );
    }
    uv.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  _buildSparks() {
    const count = isCoarsePointer ? 46 : 72;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const random = mulberry32(7531);
    for (let i = 0; i < count; i++) {
      const angle = random() * TAU;
      const radius = 0.25 + random() * 1.35;
      const y = 3.46 + (random() - 0.5) * 0.22;
      this.sparkData.push({
        angle,
        radius,
        y,
        speed: 0.25 + random() * 1.1,
        size: random(),
      });
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      colors[i * 3] = 1;
      colors[i * 3 + 1] = 0.82 + random() * 0.16;
      colors[i * 3 + 2] = 0.5 + random() * 0.35;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: isCoarsePointer ? 0.035 : 0.028,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.sparks = new THREE.Points(geo, mat);
    this.sparks.position.y = 0;
    this.toyRoot.add(this.sparks);
  }

  _buildAtmosphere() {
    const count = 240;
    const positions = new Float32Array(count * 3);
    const random = mulberry32(88512);
    this.dustData = [];
    for (let i = 0; i < count; i++) {
      const radius = 2.2 + random() * 12;
      const angle = random() * TAU;
      const y = 0.4 + random() * 8;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      this.dustData.push({ angle, radius, y, speed: 0.015 + random() * 0.05, phase: random() * TAU });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffe0a0,
      size: 0.032,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, mat);
    this.scene.add(this.dust);

    // A very soft contact shadow.
    const shadowTex = canvasTexture(256, 256, (ctx, w, h) => {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(24, 34, 19, 0.54)');
      grad.addColorStop(0.38, 'rgba(24, 34, 19, 0.24)');
      grad.addColorStop(1, 'rgba(24, 34, 19, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.6 })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.008;
    this.root.add(contact);
  }

  _setupControls() {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 2.5, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 4.6;
    this.controls.maxDistance = 12.5;
    this.controls.minPolarAngle = 0.24;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.75;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = reducedMotion ? 0 : 0.34;
    this.controls.update();
  }

  setIntroMode(intro) {
    this.introMode = intro;
    this.controls.autoRotate = intro && !reducedMotion;
    this.controls.enabled = !intro;
    if (!intro) {
      this.controls.autoRotate = false;
      this.controls.target.set(0, 2.5, 0);
      this.camera.position.set(3.4, 5.0, 6.4);
      this.controls.update();
    }
  }

  setHover(hovered) {
    this.hovered = hovered;
    this.canvas.classList.toggle('is-scrubbing', hovered);
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.pickMeshes, false).length > 0;
  }

  getToyAnchor() {
    const v = new THREE.Vector3(0, 2.2, 0);
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight,
      visible: v.z < 1,
    };
  }

  update(dt, elapsed, state) {
    this.clockTime = elapsed;
    const speed = clamp(state.speedRatio || 0, 0, 1);
    this.speedRatio = speed;
    this.currentAngle = state.angle || 0;
    this.rubPulse = state.rubPulse || 0;

    this.spinGroup.rotation.y = this.currentAngle;
    this.rotorPivot.rotation.x = state.bob || 0;

    // A fixed tilt keeps the thin wing readable from the default camera;
    // dynamic wobble grows with rotor speed.
    this.bladeTilt.rotation.x = 0.28 + (state.tiltX || 0);
    this.bladeTilt.rotation.z = -0.035 + (state.tiltZ || 0);

    // Performance mode: 8 cheap blade copies. Quality mode: full-screen
    // AfterimagePass. Only one of the two is ever active.
    if (this.usePost) {
      for (const ghost of this.ghosts) ghost.group.visible = false;
      this.afterimagePass.damp = Math.pow(speed, 1.35) * 0.82;
    } else {
      this.afterimagePass.damp = 0;
      const ghostStrength = Math.pow(speed, 1.65);
      const lag = 0.11 + speed * 0.42;
      for (const ghost of this.ghosts) {
        const idx = ghost.index + 1;
        ghost.group.visible = ghostStrength > 0.005;
        ghost.group.rotation.y = this.currentAngle - idx * lag;
        const fade = Math.max(0, 1 - idx / (this.ghostCount + 1));
        ghost.material.opacity = ghostStrength * fade * 0.13;
      }
    }

    if (this.ringGlow) {
      this.ringGlow.material.uniforms.uSpeed.value = speed;
      this.ringGlow.material.uniforms.uTime.value = elapsed;
      this.ringGlow.visible = speed > 0.03;
      this.ringGlow.rotation.z = this.currentAngle * 0.04;
    }
    for (const ring of this.haloRings || []) {
      ring.mesh.material.opacity = Math.pow(speed, 1.7) * ring.strength;
      ring.mesh.visible = speed > 0.02;
    }
    for (const sprite of this.tipSprites) {
      sprite.material.opacity = Math.pow(speed, 1.2) * 0.72;
    }

    // Tassel flares outward under centrifugal load.
    const flare = speed * 0.96 + Math.sin(elapsed * 14) * speed * 0.055;
    this.tasselPivot.rotation.z = flare;
    this.tasselPivot.rotation.x = Math.cos(elapsed * 9.5) * speed * 0.11;
    this.tasselPivot.position.y = -0.08 - speed * 0.02;

    this.atmosAccumulator += dt;
    const updateAtmosphere = this.atmosAccumulator >= 1 / 30;
    const atmosphereDt = Math.min(this.atmosAccumulator, 0.1);
    if (updateAtmosphere) this.atmosAccumulator = 0;

    if (updateAtmosphere) {
      // Swirling air sparks.
      if (this.sparks) {
        const attr = this.sparks.geometry.attributes.position;
        for (let i = 0; i < this.sparkData.length; i++) {
          const s = this.sparkData[i];
          s.angle += (0.12 + s.speed * (0.4 + speed * 2.7)) * atmosphereDt;
          const r = s.radius + Math.sin(elapsed * 1.3 + s.size * 9) * 0.03;
          attr.setXYZ(
            i,
            Math.cos(s.angle) * r,
            s.y + Math.sin(elapsed * 2.2 + s.size * 5) * 0.04,
            Math.sin(s.angle) * r
          );
        }
        attr.needsUpdate = true;
        this.sparks.material.opacity = Math.pow(speed, 1.45) * 0.9;
        this.sparks.visible = speed > 0.02;
        this.sparks.rotation.y = this.currentAngle * 0.2;
      }

      for (const cloud of this.clouds) {
        cloud.sprite.position.x = cloud.baseX + Math.sin(elapsed * cloud.speed + cloud.baseX) * 1.3;
      }

      if (this.dust) {
        const attr = this.dust.geometry.attributes.position;
        for (let i = 0; i < this.dustData.length; i++) {
          const d = this.dustData[i];
          d.angle += d.speed * atmosphereDt;
          attr.setXYZ(
            i,
            Math.cos(d.angle) * d.radius,
            d.y + Math.sin(elapsed * 0.3 + d.phase) * 0.25,
            Math.sin(d.angle) * d.radius
          );
        }
        attr.needsUpdate = true;
      }
    }

    this.controls.autoRotate = this.introMode && !reducedMotion;
    this.controls.update();
    this.renderer.info.reset();
    if (this.usePost) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.renderedFrames++;
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    // Keep the tall toy in frame on portrait phones.
    if (width / height < 0.72) {
      this.camera.fov = 49;
    } else {
      this.camera.fov = 44;
    }
    this.camera.updateProjectionMatrix();

    // <= 1.5 DPR and <= 1080p worth of pixels. A 4K browser window renders
    // at 1920×1080 instead of brute-forcing the native 8.3M pixels.
    const pixelRatio = this._computePixelRatio(width, height);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);
    }
    this.pixelRatio = pixelRatio;
  }

  setQuality(mode) {
    const requested = mode === 'quality' ? 'quality' : 'performance';
    this.qualityMode = this.softwareGPU ? 'performance' : requested;
    this.lowPower = false;
    this.usePost = this.qualityMode === 'quality';
    this.renderer.toneMappingExposure = this.usePost ? 0.92 : 1.28;
    if (!this.usePost) {
      for (const ghost of this.ghosts) ghost.group.visible = false;
    }
    this.resize();
    return this.qualityMode;
  }

  setLowPower(enabled) {
    if (this.lowPower === enabled && !enabled) return;
    this.lowPower = enabled;
    if (enabled) {
      this.qualityMode = 'performance';
      this.usePost = false;
      this.renderer.toneMappingExposure = 1.28;
    }
    this.resize();
  }

  screenshotReady() {
    this.renderer.info.reset();
    if (this.usePost) this.composer.render(0);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    try { this.composer?.dispose(); } catch (error) { /* noop */ }
    try { this.renderer.dispose(); } catch (error) { /* noop */ }
  }
}
