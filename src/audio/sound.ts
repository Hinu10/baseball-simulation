// Web Audio で短い効果音を生成する。音声素材の読み込みは不要。
export type SoundKind = 'pitch' | 'bat' | 'bunt' | 'glove' | 'bounce' | 'throw' | 'fence' | 'miss' | 'call' | 'out' | 'safe' | 'score' | 'homerun';

export class Sound {
  enabled = true;
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<SoundKind, number>();
  /** 歓声の出力。ポーズやメニューではここを絞り、鳴っている歓声も止める。 */
  private crowd: GainNode | null = null;
  private crowdLoop: AudioBuffer | null = null;
  private crowdOn = false;
  private lastCheer = -1;

  unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
    } catch {
      // 音声機能が使えなくても試合は続ける。
    }
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.5), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    return (this.noise = buffer);
  }

  /** 歓声用の長いノイズ。繰り返しが耳につかないよう 4 秒にする。 */
  private loopBuffer(ctx: AudioContext): AudioBuffer {
    if (this.crowdLoop) return this.crowdLoop;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < samples.length; i++) {
      // 少し低域寄りのノイズにして、歓声らしくする。
      last = last * 0.6 + (Math.random() * 2 - 1) * 0.4;
      samples[i] = last * 1.8;
    }
    return (this.crowdLoop = buffer);
  }

  private crowdBus(ctx: AudioContext): GainNode {
    if (this.crowd) return this.crowd;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(ctx.destination);
    return (this.crowd = bus);
  }

  /** 試合中だけ歓声を通す。毎フレーム呼んでよい（変わったときだけフェードする）。 */
  setCrowd(active: boolean) {
    const ctx = this.context;
    const on = active && this.enabled;
    if (!ctx || ctx.state !== 'running' || on === this.crowdOn) return;
    this.crowdOn = on;
    const gain = this.crowdBus(ctx).gain;
    gain.cancelScheduledValues(ctx.currentTime);
    gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, on ? 0.05 : 0.15);
  }

  /** 安打・得点・本塁打の歓声。strength は 0.5（安打）〜 1.2（本塁打）くらい。 */
  cheer(strength: number) {
    const ctx = this.context;
    if (!this.enabled || !this.crowdOn || !ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime;
    if (at - this.lastCheer < 0.5) return;
    this.lastCheer = at;
    const power = Math.max(0.2, Math.min(1.3, strength));
    const length = 1.1 + 1.8 * power;
    const bus = this.crowdBus(ctx);
    for (const [frequency, share] of [[900, 1], [2300, 0.35]] as const) {
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      source.buffer = this.loopBuffer(ctx);
      source.loop = true;
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = 0.5;
      const peak = 0.11 * power * share;
      gain.gain.setValueAtTime(0.001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.2 + 0.15 * power);
      gain.gain.setValueAtTime(peak, at + 0.35 + 0.5 * power);
      gain.gain.exponentialRampToValueAtTime(0.001, at + length);
      source.connect(filter).connect(gain).connect(bus);
      source.start(at, Math.random() * 3);
      source.stop(at + length + 0.05);
    }
  }

  private tone(ctx: AudioContext, at: number, frequency: number, endFrequency: number, duration: number, volume: number, type: OscillatorType = 'sine') {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), at + duration);
    gain.gain.setValueAtTime(0.001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + Math.min(0.008, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
  }

  private burst(ctx: AudioContext, at: number, duration: number, volume: number, cutoff: number) {
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noiseBuffer(ctx);
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(at);
    source.stop(at + duration);
  }

  play(kind: SoundKind, strength = 1) {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime;
    // 早送り中に同種の音が重なり過ぎないようにする。
    if (at - (this.lastPlayed.get(kind) ?? -1) < 0.08) return;
    this.lastPlayed.set(kind, at);
    const power = Math.max(0.45, Math.min(1.4, strength));
    switch (kind) {
      case 'pitch':
        this.burst(ctx, at, 0.13, 0.075, 1200);
        this.tone(ctx, at, 230, 95, 0.16, 0.06);
        break;
      case 'bat':
        this.burst(ctx, at, 0.09, 0.28 * power, 3600);
        this.tone(ctx, at, 560, 165, 0.16, 0.23 * power, 'triangle');
        this.tone(ctx, at, 1050, 420, 0.08, 0.09 * power);
        break;
      case 'bunt':
        this.burst(ctx, at, 0.055, 0.12, 2400);
        this.tone(ctx, at, 340, 180, 0.1, 0.08, 'triangle');
        break;
      case 'glove':
        this.burst(ctx, at, 0.12, 0.22 * power, 950);
        this.tone(ctx, at, 145, 65, 0.12, 0.14 * power);
        break;
      case 'bounce':
        this.burst(ctx, at, 0.055, 0.12, 1100);
        this.tone(ctx, at, 190, 85, 0.07, 0.07);
        break;
      case 'throw':
        this.burst(ctx, at, 0.1, 0.065, 1800);
        this.tone(ctx, at, 320, 145, 0.12, 0.045);
        break;
      case 'fence':
        this.burst(ctx, at, 0.2, 0.2, 1700);
        this.tone(ctx, at, 280, 80, 0.22, 0.16, 'triangle');
        break;
      case 'miss':
        this.burst(ctx, at, 0.14, 0.06, 1500);
        break;
      case 'call':
        this.tone(ctx, at, 480, 400, 0.1, 0.065, 'triangle');
        break;
      case 'out':
        this.tone(ctx, at, 420, 270, 0.16, 0.09, 'triangle');
        break;
      case 'safe':
        this.tone(ctx, at, 480, 670, 0.13, 0.08, 'triangle');
        break;
      case 'score':
        this.tone(ctx, at, 520, 520, 0.16, 0.09, 'triangle');
        this.tone(ctx, at + 0.12, 660, 660, 0.22, 0.09, 'triangle');
        break;
      case 'homerun':
        this.tone(ctx, at, 390, 390, 0.18, 0.11, 'triangle');
        this.tone(ctx, at + 0.13, 520, 520, 0.18, 0.11, 'triangle');
        this.tone(ctx, at + 0.26, 780, 780, 0.38, 0.12, 'triangle');
        break;
    }
  }
}
