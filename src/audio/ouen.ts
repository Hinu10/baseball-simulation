// 応援席の鳴り物：トランペットのメロディと太鼓を Web Audio で作って鳴らす（音声素材は使わない）。
// メロディは球団の ID から決まり、球団ごとに違う。チャンスでは短調の速い「チャンステーマ」に切り替える。

/** 1小節の拍数と、くり返す小節数。 */
const BEATS = 4;
const BARS = 4;
const TEMPO = { normal: 132, chance: 152 };
/** トランペットの音階（半音）。ふだんは長調、チャンスは短調の五音音階。 */
const SCALE = { normal: [0, 2, 4, 7, 9, 12, 14, 16], chance: [0, 3, 5, 7, 10, 12, 15, 17] };
const ROOT = { normal: 392, chance: 349 };
/** 1拍の刻み方（拍の長さに対する割合）。 */
const RHYTHMS = [[1], [0.5, 0.5], [0.75, 0.25], [0.5, 0.25, 0.25], [0.25, 0.25, 0.5]];
/** 先読みして予約する秒。 */
const LOOKAHEAD = 0.3;
const VOLUME = 0.075;

interface Note {
  /** 曲の頭からの拍。 */
  at: number;
  len: number;
  /** 音の高さ（Hz）。null は休み。 */
  freq: number | null;
}

interface Theme {
  tempo: number;
  notes: Note[];
  /** 太鼓を打つ拍。 */
  drums: number[];
}

/** 文字列から決まる乱数（mulberry32）。 */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 球団 teamId の応援歌（chance ならチャンステーマ）。2小節ずつの問いと答えで、最後は主音に戻る。 */
export function themeOf(teamId: string, chance: boolean): Theme {
  const kind = chance ? 'chance' : 'normal';
  const rand = seeded(`${teamId}:${kind}`);
  const scale = SCALE[kind];
  const notes: Note[] = [];
  const total = BEATS * BARS;
  let step = Math.floor(rand() * 3) + 2;
  // 前半2小節を作り、後半は同じリズムで終わりだけ主音へ向かう（応援歌らしいくり返し）。
  const half: { at: number; len: number; step: number }[] = [];
  for (let beat = 0; beat < total / 2; beat++) {
    const rhythm = beat === total / 2 - 1 ? [1] : RHYTHMS[Math.floor(rand() * RHYTHMS.length)];
    let at = beat;
    for (const r of rhythm) {
      step = Math.max(0, Math.min(scale.length - 1, step + Math.round((rand() - 0.5) * 3)));
      half.push({ at, len: r, step });
      at += r;
    }
  }
  const freq = (k: number) => ROOT[kind] * 2 ** (scale[k] / 12);
  for (const n of half) notes.push({ at: n.at, len: n.len, freq: freq(n.step) });
  half.forEach((n, i) => {
    const toward = i >= half.length - 3 ? Math.max(0, n.step - (half.length - i)) : n.step;
    notes.push({ at: n.at + total / 2, len: n.len, freq: freq(i === half.length - 1 ? 0 : toward) });
  });
  // 太鼓：各拍に1つ、小節の終わりは「ドドン」。チャンスは裏拍も打つ。
  const drums: number[] = [];
  for (let beat = 0; beat < total; beat++) {
    drums.push(beat);
    if (chance || beat % BEATS === BEATS - 1) drums.push(beat + 0.5);
  }
  return { tempo: TEMPO[kind], notes, drums };
}

export class Ouen {
  private readonly ctx: AudioContext;
  private readonly bus: GainNode;
  private theme: Theme | null = null;
  private key = '';
  /** 曲の頭の時刻（AudioContext の秒）と、どこまで予約したか（拍）。 */
  private start = 0;
  private scheduled = 0;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(destination);
  }

  /** 鳴らす応援。teamId が null なら止める（フェードアウト）。毎フレーム呼んでよい。 */
  set(teamId: string | null, chance: boolean) {
    const key = teamId ? `${teamId}:${chance}` : '';
    if (key === this.key) return;
    this.key = key;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(teamId ? 1 : 0, now, teamId ? 0.08 : 0.25);
    if (!teamId) return;
    this.theme = themeOf(teamId, chance);
    // 頭から鳴らす（拍の頭にそろえて少し後から）。
    this.start = now + 0.08;
    this.scheduled = 0;
  }

  /** 先読みして音を予約する。毎フレーム呼ぶ。 */
  update() {
    const theme = this.theme;
    if (!theme || !this.key) return;
    const beat = 60 / theme.tempo;
    const total = BEATS * BARS;
    const until = (this.ctx.currentTime + LOOKAHEAD - this.start) / beat;
    while (this.scheduled < until) {
      const from = this.scheduled;
      const to = from + 1;
      const loop = Math.floor(from / total) * total;
      for (const n of theme.notes) {
        const at = loop + n.at;
        if (at >= from && at < to && n.freq) this.trumpet(this.start + at * beat, n.len * beat * 0.92, n.freq);
      }
      for (const d of theme.drums) {
        const at = loop + d;
        if (at >= from && at < to) this.drum(this.start + at * beat, d % BEATS === 0);
      }
      this.scheduled = to;
    }
  }

  /** トランペット：のこぎり波と矩形波を重ね、明るすぎないよう高音を削る。少しビブラート。 */
  private trumpet(at: number, len: number, freq: number) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2600;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(VOLUME, at + 0.025);
    gain.gain.setValueAtTime(VOLUME * 0.8, at + Math.max(0.03, len - 0.04));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.03);
    const vibrato = ctx.createOscillator();
    const depth = ctx.createGain();
    vibrato.frequency.value = 5.5;
    depth.gain.value = freq * 0.006;
    vibrato.connect(depth);
    for (const [type, share] of [['sawtooth', 0.7], ['square', 0.3]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      depth.connect(o.frequency);
      g.gain.value = share;
      o.connect(g).connect(filter);
      o.start(at);
      o.stop(at + len + 0.05);
    }
    vibrato.start(at);
    vibrato.stop(at + len + 0.05);
    filter.connect(gain).connect(this.bus);
  }

  /** 太鼓：低い音が下がりながら響く。小節の頭は強く。 */
  private drum(at: number, accent: boolean) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, at);
    o.frequency.exponentialRampToValueAtTime(48, at + 0.2);
    const v = accent ? 0.32 : 0.22;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(v, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    o.connect(g).connect(this.bus);
    o.start(at);
    o.stop(at + 0.3);
  }
}
