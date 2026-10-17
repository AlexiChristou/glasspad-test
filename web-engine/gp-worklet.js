// GlassPad engine core in the browser: gpcore.wasm (the same C++ core as the Android app) run in an AudioWorklet.
// Created with processorOptions.wasm = the module's bytes. Messages from the page: arrays [name, ...args], where frame
// arguments are context frames (time × sampleRate); mixers: [name, Float32Array]. Every ~250 ms it posts its counters.
class GPCore extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const stub = () => 0;
    const mod = new WebAssembly.Module(opts.processorOptions.wasm);
    this.ex = new WebAssembly.Instance(mod, { wasi_snapshot_preview1: { fd_close: stub, fd_seek: stub, fd_write: stub, proc_exit: stub } }).exports;
    if (this.ex._initialize) this.ex._initialize();
    this.ex.gp_init(sampleRate);
    this.off = null;   // context frame of the core's frame 0
    this.q = [];       // messages that arrived before the first block
    this.tick = 0;
    this.port.onmessage = e => { if (this.off === null) this.q.push(e.data); else this.run(e.data); };
  }
  f(at) { return at - this.off; }
  run(m) {
    const x = this.ex, n = m[0];
    if (Array.isArray(n)) { for (const one of m) this.run(one); return; }   // a batch
    switch (n) {
      case "drum": x.gp_drum(m[1], m[2], this.f(m[3])); break;
      case "bass": x.gp_bass(m[1], m[2], m[3], this.f(m[4])); break;
      case "bassCut": x.gp_bassCut(); break;
      case "allOff": x.gp_allOff(); break;
      case "padNote": x.gp_padNote(m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], this.f(m[9])); break;
      case "padRelease": x.gp_padRelease(m[1], m[2], this.f(m[3])); break;
      case "pump": x.gp_pump(m[1], this.f(m[2])); break;
      case "bandSetup": {   // the band's setup: JSON as UTF-8 bytes (an AudioWorklet has no TextEncoder)
        const bytes = m[1], p = x.gp_strbuf(bytes.length), mem = new Uint8Array(x.memory.buffer, p, bytes.length + 1);
        mem.set(bytes); mem[bytes.length] = 0; x.gp_bandSetup(); break;
      }
      case "bassHold": x.gp_bassHold(m[1], m[2], m[3]); break;
      case "bassGlide": x.gp_bassGlide(m[1], m[2], m[3], m[4] >= 0 ? this.f(m[4]) : -1); break;
      case "bassBright": x.gp_bassBright(m[1], m[2], m[3], m[4] >= 0 ? this.f(m[4]) : -1); break;
      case "bassLetGo": x.gp_bassLetGo(m[1], m[2], m[3] >= 0 ? this.f(m[3]) : -1); break;
      case "leadHold": x.gp_leadHold(m[1], m[2], m[3], m[4]); break;
      case "leadGlide": x.gp_leadGlide(m[1], m[2], m[3], m[4] >= 0 ? this.f(m[4]) : -1); break;
      case "leadBright": x.gp_leadBright(m[1], m[2], m[3], m[4] >= 0 ? this.f(m[4]) : -1); break;
      case "leadLetGo": x.gp_leadLetGo(m[1], m[2], m[3] >= 0 ? this.f(m[3]) : -1); break;
      case "arpSet": {
        const bytes = m[1], p = x.gp_strbuf(bytes.length), mem = new Uint8Array(x.memory.buffer, p, bytes.length + 1);
        mem.set(bytes); mem[bytes.length] = 0; x.gp_arpSet(); break;
      }
      case "kitLoad": case "kitUse": {   // 0.3.6: a sample kit's JSON, or the kit to use, as UTF-8 bytes
        const bytes = m[1], p = x.gp_strbuf(bytes.length), mem = new Uint8Array(x.memory.buffer, p, bytes.length + 1);
        mem.set(bytes); mem[bytes.length] = 0; x["gp_" + n](); break;
      }
      case "loopSetup": { const bytes = m[1], p = x.gp_strbuf(bytes.length), mem = new Uint8Array(x.memory.buffer, p, bytes.length + 1); mem.set(bytes); mem[bytes.length] = 0; x.gp_loopSetup(); break; }
      case "loopIn": x.gp_loopIn(m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10]); break;
      case "loopCmd": x.gp_loopCmd(m[1], m[2], m[3]); break;
      case "drum2": x.gp_drum2(m[1], m[2], m[3], m[4], this.f(m[5])); break;
      case "bandCmd": x.gp_bandCmd(m[1], m[2], m[3] >= 0 ? this.f(m[3]) : -1); break;
      case "drumMix": case "bassMix": case "padMix": case "leadMix": {
        const a = new Float32Array(x.memory.buffer, x.gp_args(), 96); a.fill(0); a.set(m[1].slice(0, 96));
        x["gp_" + n](); break;
      }
    }
  }
  process(_, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, x = this.ex;
    if (this.off === null) { this.off = currentFrame - x.gp_written(); for (const m of this.q) this.run(m); this.q = []; }
    const p = x.gp_render(n), buf = new Float32Array(x.memory.buffer, p, 2 * n);
    for (let i = 0; i < n; i++) { L[i] = buf[2 * i]; if (R !== L) R[i] = buf[2 * i + 1]; }
    // the band's screen events, with context frames
    const k = x.gp_uiPoll();
    if (k) { const u = new Float64Array(x.memory.buffer, x.gp_uiBuf(), 5 * k), ev = []; for (let i = 0; i < k; i++) ev.push([u[5 * i], u[5 * i + 1] + this.off, u[5 * i + 2], u[5 * i + 3], u[5 * i + 4]]); this.port.postMessage({ ui: ev }); }
    if ((this.tick += n) >= sampleRate / 4) {
      this.tick = 0;
      const s = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(k => x.gp_stat(k));
      let diary = "[]"; try { const p = x.gp_diary(), n = x.gp_diaryLen(), b = new Uint8Array(x.memory.buffer, p, n); diary = String.fromCharCode.apply(null, b); } catch (_) {}
      this.port.postMessage({ stats: { diary: JSON.parse(diary), drumHits: s[0], drumLate: s[1], drumLateMaxMs: s[2], bassNotes: s[3], bassLate: s[4], padNotes: s[5], padLate: s[6], padLateMaxMs: s[7], bassPad: s[8], arpLead: s[9], arpBass: s[10], arpMiss: s[11], bandArps: s[12], bandBassHeld: s[13], kitHits: s[14], kitMissing: s[15], kitsLoaded: s[16], loopMode: s[17], loopLayers: s[18], loopEvents: s[19], loopPlayed: s[20], loopNotes: s[21] } });
    }
    return true;
  }
}
registerProcessor("gp-core", GPCore);
