const TAU = Math.PI * 2;
const MAX_RPM = 5200;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function estimateFundamental(rpm) {
  const speed = clamp(rpm / MAX_RPM, 0, 1);
  return 100 + 930 * Math.pow(speed, 1.18);
}

export function estimateBrightness(rpm) {
  return clamp((rpm - 160) / 4800, 0, 1);
}

const PROCESSOR_SOURCE = `
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

class CicadaProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: 'rpm',
      defaultValue: 0,
      minValue: 0,
      maxValue: 5200,
      automationRate: 'a-rate'
    }];
  }

  constructor() {
    super();
    this.phases = new Float64Array(9);
    this.phasesB = new Float64Array(6);
    this.subPhase = 0;
    this.bladePhase = 0;
    this.wowPhase = 0;
    this.slowPhase = 0;
    this.lowpass = 0;
    this.svfLow = 0;
    this.svfBand = 0;
    this.noiseState = 0x12345678;
    this.envelope = 0;
    this.lastRpm = 0;
    this.silentFrames = 0;
    this.random = () => {
      this.noiseState ^= this.noiseState << 13;
      this.noiseState ^= this.noiseState >>> 17;
      this.noiseState ^= this.noiseState << 5;
      return ((this.noiseState >>> 0) / 4294967296) * 2 - 1;
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output.length > 1 ? output[1] : left;
    const rpmArr = parameters.rpm;
    const sr = sampleRate;
    let anySound = false;

    // When the rotor is stopped and the release tail is silent, skip the
    // entire synthesis pass. The audio thread becomes almost free at rest.
    if (this.envelope < 0.00001 && rpmArr[0] < 0.5) {
      left.fill(0);
      right.fill(0);
      return true;
    }

    for (let i = 0; i < left.length; i++) {
      const rpm = rpmArr.length > 1 ? rpmArr[i] : rpmArr[0];
      this.lastRpm = rpm;
      const speed = clamp(rpm / 5200, 0, 1);
      const audible = smoothstep(150, 560, rpm);
      const brightness = clamp((rpm - 160) / 4800, 0, 1);
      const rotHz = rpm / 60;

      this.bladePhase += (rotHz * TAU) / sr;
      if (this.bladePhase > TAU) this.bladePhase -= TAU;
      const wowRate = 2.15 + speed * 3.9;
      this.wowPhase += (wowRate * TAU) / sr;
      if (this.wowPhase > TAU) this.wowPhase -= TAU;
      this.slowPhase += (0.63 * TAU) / sr;
      if (this.slowPhase > TAU) this.slowPhase -= TAU;

      const f0 = 100 + 930 * Math.pow(speed, 1.18) + Math.sin(this.wowPhase) * 2.5 * speed;
      const breath = 0.84 + 0.16 * Math.sin(this.wowPhase);
      const slow = 0.93 + 0.07 * Math.sin(this.slowPhase + 0.8);
      const blade = 0.76 + 0.24 * Math.sin(this.bladePhase * 2);

      let tone = 0;
      let norm = 0;
      const brightCurve = 0.33 + 0.67 * brightness;
      for (let h = 1; h <= 9; h++) {
        const amp = Math.pow(1 / h, 1.22) * Math.pow(brightCurve, h - 1);
        const freq = f0 * h * (1 + 0.00065 * h * h);
        this.phases[h - 1] += (freq * TAU) / sr;
        if (this.phases[h - 1] > TAU) this.phases[h - 1] -= TAU;
        tone += Math.sin(this.phases[h - 1]) * amp;
        norm += amp;
      }
      tone /= Math.max(0.72, norm);

      let chorus = 0;
      let cnorm = 0;
      for (let h = 1; h <= 6; h++) {
        const amp = Math.pow(1 / h, 1.35) * Math.pow(brightCurve, h - 1);
        const freq = f0 * h * 1.0042 * (1 + 0.0005 * h * h);
        this.phasesB[h - 1] += (freq * TAU) / sr;
        if (this.phasesB[h - 1] > TAU) this.phasesB[h - 1] -= TAU;
        chorus += Math.sin(this.phasesB[h - 1]) * amp;
        cnorm += amp;
      }
      chorus = (chorus / Math.max(0.75, cnorm)) * 0.44;

      this.subPhase += (f0 * 0.5 * TAU) / sr;
      if (this.subPhase > TAU) this.subPhase -= TAU;
      const sub = Math.sin(this.subPhase) * 0.055 * speed;

      const white = this.random();
      const fc = 680 + Math.pow(speed, 0.78) * 5200;
      const f = 2 * Math.sin(Math.PI * Math.min(fc, sr * 0.41) / sr);
      const q = 0.72 + speed * 1.15;
      const high = white - this.svfLow - q * this.svfBand;
      this.svfBand += f * high;
      this.svfLow += f * this.svfBand;
      const air = this.svfBand * (0.018 + Math.pow(speed, 0.95) * 0.105);

      const lowCut = 260 + speed * 1450;
      this.lowpass += (white - this.lowpass) * (lowCut / sr) * TAU;
      const roar = this.lowpass * (0.008 + Math.pow(speed, 1.4) * 0.055);

      const texture = 0.72 + 0.16 * breath + 0.12 * blade;
      let sample = (tone + chorus + sub) * texture + air * (0.7 + 0.3 * blade) + roar;
      sample *= 0.36;

      const targetGain = audible * Math.pow(speed, 1.15) * 1.12;
      const coeff = targetGain > this.envelope ? 0.0019 : 0.000115;
      this.envelope += (targetGain - this.envelope) * coeff;
      if (this.envelope < 0.00002) this.envelope = 0;

      const amp = this.envelope * (0.72 + 0.2 * slow + 0.08 * blade);
      let out = sample * amp;

      // Gentle saturation keeps the buzz dense without digital clipping.
      out = Math.tanh(out * 1.8) * 0.94;

      const pan = 0.13 * Math.sin(this.wowPhase * 0.58 + 0.4) + 0.05 * Math.sin(this.bladePhase);
      const decorrel = this.svfBand * 0.008 * speed;
      left[i] = out * (1 - pan) + decorrel;
      right[i] = out * (1 + pan) - decorrel;
      if (Math.abs(out) > 0.0005) anySound = true;
    }

    if (!anySound) {
      this.silentFrames++;
    } else {
      this.silentFrames = 0;
    }
    return true;
  }
}

registerProcessor('cicada-processor', CicadaProcessor);
`;

function makeImpulseResponse(ctx, seconds = 1.15, decay = 3.2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const noise = Math.random() * 2 - 1;
      last = last * 0.62 + noise * 0.38;
      const envelope = Math.pow(1 - t, 2.35) * Math.exp(-t * decay);
      data[i] = last * envelope * (channel === 0 ? 1 : 0.86);
    }
  }
  return impulse;
}

function fftMagnitudes(samples, sampleRate) {
  let n = 1;
  while (n * 2 <= samples.length) n *= 2;
  const size = Math.min(n, 16384);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const start = Math.max(0, samples.length - size);
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((TAU * i) / (size - 1));
    re[i] = (samples[start + i] || 0) * w;
  }

  // In-place radix-2 FFT.
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const angle = (-TAU) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < size; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  const bins = [];
  for (let i = 1; i < size / 2; i++) {
    bins.push({
      freq: (i * sampleRate) / size,
      mag: Math.hypot(re[i], im[i]),
    });
  }
  return bins;
}

function analyzeBuffer(buffer) {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const start = Math.floor(data.length * 0.5);
  let sum = 0;
  let peak = 0;
  for (let i = start; i < data.length; i++) {
    const v = data[i];
    sum += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const rms = Math.sqrt(sum / Math.max(1, data.length - start));
  const region = data.slice(start);
  const bins = fftMagnitudes(region, sampleRate);
  let dominant = bins[0] || { freq: 0, mag: 0 };
  for (const bin of bins) {
    if (bin.freq >= 60 && bin.freq <= 4200 && bin.mag > dominant.mag) dominant = bin;
  }
  let magSum = 0;
  let weighted = 0;
  for (const bin of bins) {
    if (bin.freq < 50 || bin.freq > 12000) continue;
    magSum += bin.mag;
    weighted += bin.freq * bin.mag;
  }

  // Slow amplitude modulation ("wah-wah") measured from a 200 Hz envelope.
  const envRate = 200;
  const block = Math.max(16, Math.floor(sampleRate / envRate));
  const envelope = [];
  for (let i = start; i + block < data.length; i += block) {
    let s = 0;
    for (let j = 0; j < block; j++) s += data[i + j] * data[i + j];
    envelope.push(Math.sqrt(s / block));
  }
  let modDepth = 0;
  let modHz = 0;
  if (envelope.length > 10) {
    const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
    const min = Math.min(...envelope);
    const max = Math.max(...envelope);
    modDepth = mean > 0 ? (max - min) / mean : 0;
    let best = 0;
    for (let hz = 1; hz <= 10; hz += 0.25) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < envelope.length; i++) {
        const t = i / envRate;
        re += (envelope[i] - mean) * Math.cos(TAU * hz * t);
        im += (envelope[i] - mean) * Math.sin(TAU * hz * t);
      }
      const mag = Math.hypot(re, im);
      if (mag > best) {
        best = mag;
        modHz = hz;
      }
    }
  }

  return {
    rms,
    peak,
    dominantHz: Math.round(dominant.freq),
    centroidHz: Math.round(weighted / Math.max(1e-9, magSum)),
    db: 20 * Math.log10(Math.max(1e-6, rms)),
    modDepth: Number(modDepth.toFixed(2)),
    modHz: Number(modHz.toFixed(2)),
  };
}

export class CicadaAudio {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.analyser = null;
    this.master = null;
    this.ready = false;
    this.started = false;
    this.muted = false;
    this.targetRpm = 0;
    this._lastParamRpm = -1;
    this.lastDisplay = { levelDb: -96, rms: 0, fundamental: estimateFundamental(0) };
    this._statsAt = 0;
    this._waveData = new Float32Array(1024);
    this._moduleUrl = null;
    this._initPromise = null;
  }

  get supported() {
    return !!(window.AudioContext || window.webkitAudioContext) && !!window.AudioWorkletNode;
  }

  async init() {
    if (this.ready) return true;
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('当前浏览器不支持 Web Audio API');
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });
      if (!this.ctx.audioWorklet) throw new Error('当前浏览器不支持 AudioWorklet');
      if (!this._moduleUrl) {
        this._moduleUrl = URL.createObjectURL(
          new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' })
        );
      }
      await this.ctx.audioWorklet.addModule(this._moduleUrl);

      this.node = new AudioWorkletNode(this.ctx, 'cicada-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node.parameters.get('rpm').setValueAtTime(0, this.ctx.currentTime);

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 16;
      compressor.ratio.value = 3.2;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.22;

      const dry = this.ctx.createGain();
      dry.gain.value = 0.9;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.13;
      const convolver = this.ctx.createConvolver();
      convolver.buffer = makeImpulseResponse(this.ctx);

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.72;

      this.node.connect(dry).connect(compressor);
      this.node.connect(convolver).connect(wet).connect(compressor);
      compressor.connect(this.analyser);
      compressor.connect(this.master).connect(this.ctx.destination);

      this.ready = true;
      return true;
    })();
    try {
      return await this._initPromise;
    } catch (error) {
      this._initPromise = null;
      throw error;
    }
  }

  async start() {
    if (!this.ready) await this.init();
    if (this.ctx.state !== 'running') {
      await this.ctx.resume();
    }
    this.started = true;
    return this.ctx.state === 'running';
  }

  setRpm(rpm, immediate = false) {
    this.targetRpm = rpm;
    if (!this.ready) return;
    if (!immediate && Math.abs(rpm - this._lastParamRpm) < 0.35) return;
    this._lastParamRpm = rpm;
    const now = this.ctx.currentTime;
    const param = this.node.parameters.get('rpm');
    if (immediate) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(rpm, now);
    } else {
      param.setTargetAtTime(Math.max(0, rpm), now, 0.022);
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(muted ? 0 : 0.9, now, 0.035);
  }

  getStats(now = performance.now()) {
    if (!this.ready) {
      return { ...this.lastDisplay, fundamental: estimateFundamental(this.targetRpm), levelDb: -96 };
    }
    if (now - this._statsAt > 80) {
      this._statsAt = now;
      this.analyser.getFloatTimeDomainData(this._waveData);
      let sum = 0;
      for (let i = 0; i < this._waveData.length; i++) sum += this._waveData[i] * this._waveData[i];
      const rms = Math.sqrt(sum / this._waveData.length);
      this.lastDisplay = {
        rms,
        levelDb: rms > 0.000001 ? 20 * Math.log10(rms) : -96,
        fundamental: estimateFundamental(this.targetRpm),
      };
    }
    return this.lastDisplay;
  }

  getWaveform() {
    if (!this.ready) return null;
    return this._waveData;
  }

  async testRender(rpm, seconds = 2.4) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) throw new Error('OfflineAudioContext unavailable');
    if (!this._moduleUrl) {
      this._moduleUrl = URL.createObjectURL(
        new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' })
      );
    }
    const ctx = new OfflineCtx(2, Math.ceil(48000 * seconds), 48000);
    await ctx.audioWorklet.addModule(this._moduleUrl);
    const node = new AudioWorkletNode(ctx, 'cicada-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.parameters.get('rpm').setValueAtTime(rpm, 0);
    node.connect(ctx.destination);
    const buffer = await ctx.startRendering();
    return { rpm, ...analyzeBuffer(buffer) };
  }

  async suspend() {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }
}
