// Wiring. The four layers — state, audio engine, renderer, transport — only meet here.

import { load, save, newState, applyPreset } from './state.js';
import { Engine } from './audio.js';
import { Transport } from './transport.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { cleanUp } from './lull.js';
import { listSamples, saveSample, deleteSample, requestPersistence } from './store.js';
import { stepVertex, pcAt, NAMES } from './tonnetz.js';

const S = load();
if (!localStorage.getItem('geometric-jelly.v2') && !location.hash && matchMedia('(max-width: 640px)').matches) S.flatten = 1;
history.replaceState(null, '', location.pathname);

save(S);

const engine = new Engine(S);
let renderer, ui;
const transport = new Transport(engine, S, (hit) => renderer.addHit(hit));
renderer = new Renderer(document.getElementById('stage'), S, transport, engine, (li, live) => {
  if (ui) {
    ui.changed('pattern', li);
    if (!live) ui.buildBench();
    else ui.paintStrip();
  }
});

let wake = null;
async function holdWake(on) {
  try {
    if (on && !wake && navigator.wakeLock) wake = await navigator.wakeLock.request('screen');
    if (!on && wake) {
      await wake.release();
      wake = null;
    }
  } catch (e) {
    wake = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (transport.playing || document.body.classList.contains('visual'))) holdWake(true);
});

let starting = null;
async function ensureAudio() {
  if (engine.ctx) {
    if (engine.ctx.state !== 'running') engine.ctx.resume();
    return;
  }
  if (!starting)
    starting = engine.init(S).then(async () => {
      const rows = await listSamples().catch(() => []);
      S.layers.forEach((L, li) => {
        const row = rows.find((r) => r.id === L.sample);
        if (row) engine.setSample(li, row.pcm, row.sr);
        else L.sample = null;
      });
    });
  await starting;
}

async function toggle() {
  if (transport.playing) {
    transport.stop();
    ui.setPlaying(false);
    holdWake(document.body.classList.contains('visual'));
    return;
  }
  await ensureAudio();
  transport.start();
  ui.setPlaying(true);
  holdWake(true);
}

function visual(on) {
  document.body.classList.toggle('visual', on);
  holdWake(on || transport.playing);
  try {
    if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) {
    /* no fullscreen API (iPhone Safari): the CSS mode still hides the controls */
  }
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.body.classList.remove('visual');
});

// ---------- recordings ----------

async function adopt(li, mono, sr, name) {
  let pcm = cleanUp(mono, sr);
  if (!pcm) return ui.note('That was silent. Nothing was kept.');
  pcm = pcm.slice(0, Math.round(sr * 2.5));
  const row = { id: 'smp-' + Date.now().toString(36), name, sr, pcm, created: Date.now() };
  try {
    await saveSample(row);
    requestPersistence();
  } catch (e) {
    ui.note('Could not store the recording on this device; it will work until you reload.');
  }
  S.layers[li].sample = row.id;
  engine.setSample(li, pcm, sr);
  save(S);
  ui.buildBench();
  ui.note(`${name} now excites ${S.layers[li].name}.`);
}

let rec = null;
async function record(li, btn) {
  if (rec) return stopRecord();
  await ensureAudio();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return ui.note('No microphone in this browser. Use Import.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const ctx = engine.ctx;
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    const chunks = [];
    proc.onaudioprocess = (ev) => chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
    src.connect(proc);
    proc.connect(sink);
    sink.connect(ctx.destination);
    rec = { li, stream, src, proc, sink, chunks, btn };
    btn.classList.add('lit');
    btn.textContent = 'Stop ●';
    ui.note(`Recording into ${S.layers[li].name}. Tap again to stop (4 s max).`);
    rec.timer = setTimeout(stopRecord, 4000);
  } catch (e) {
    ui.note('The microphone is blocked here. Import an audio file instead, or serve this page from its own site.');
  }
}

function stopRecord() {
  const r = rec;
  if (!r) return;
  rec = null;
  clearTimeout(r.timer);
  r.btn.classList.remove('lit');
  r.btn.textContent = 'Record';
  try {
    r.proc.disconnect();
    r.src.disconnect();
    r.sink.disconnect();
  } catch (e) {
    /* already gone */
  }
  r.stream.getTracks().forEach((t) => t.stop());
  const n = r.chunks.reduce((s, c) => s + c.length, 0);
  if (!n) return ui.note('Nothing was recorded.');
  const mono = new Float32Array(n);
  let o = 0;
  for (const c of r.chunks) {
    mono.set(c, o);
    o += c.length;
  }
  adopt(r.li, mono, engine.ctx.sampleRate, 'Recording ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
}

async function importFile(li, file) {
  await ensureAudio();
  try {
    const audio = await engine.ctx.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / audio.numberOfChannels;
    }
    adopt(li, mono, audio.sampleRate, file.name.replace(/\.[^.]+$/, '').slice(0, 24));
  } catch (e) {
    ui.note('That file could not be decoded.');
  }
}

async function useSample(li, id) {
  await ensureAudio();
  S.layers[li].sample = id;
  if (!id) engine.setSample(li, null);
  else {
    const row = (await listSamples()).find((r) => r.id === id);
    if (row) engine.setSample(li, row.pcm, row.sr);
  }
  save(S);
  ui.buildBench();
}

async function removeSample(li) {
  const id = S.layers[li].sample;
  if (!id || !confirm('Delete this recording from this device?')) return;
  await deleteSample(id).catch(() => {});
  S.layers.forEach((L, i) => {
    if (L.sample === id) {
      L.sample = null;
      if (engine.ctx) engine.setSample(i, null);
    }
  });
  save(S);
  ui.buildBench();
}

function reset() {
  if (!confirm('Reset every layer and the bus to defaults? Recordings are kept.')) return;
  const fresh = newState();
  applyPreset(fresh, fresh.preset);
  const { layers, ...g } = fresh;
  Object.assign(S, g, { flatten: S.flatten });
  S.layers.forEach((L, i) => Object.assign(L, layers[i]));
  S.layers.forEach((_, i) => engine.ctx && engine.setSample(i, null));
  ui.changed('all');
  ui.refresh();
}

ui = new UI(S, engine, transport, renderer, {
  toggle,
  visual,
  record,
  importFile,
  useSample,
  deleteSample: removeSample,
  reset,
  samples: () => listSamples().catch(() => []),
  stepName: (L, i) => {
    const c = transport.playing ? Math.floor(transport.pos(S.layers.indexOf(L), 0, transport.now16())) : 0;
    const [a, b] = stepVertex(L, i, 0, c);
    return NAMES[pcAt(a, b)];
  },
});

// Debug/test handle; harmless in production.
window.GJ = { S, engine, transport, renderer, ui };
