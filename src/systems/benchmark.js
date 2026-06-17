// Lightweight rendering benchmark. Smart TVs and low-end browsers can struggle
// with the full particle/parallax load, so the host samples its frame rate for
// a short window and records a quality tier in the registry. The TV renderer
// then scales effects to match. The benchmark targets RENDER throughput (the
// real bottleneck), not the trivial game simulation.

const SAMPLE_MS = 900;
const LITE_FPS_THRESHOLD = 45;

export function runBenchmark(scene) {
  const frames = [];
  let last = null;
  let elapsed = 0;

  const handler = (_time, delta) => {
    if (last !== null) {
      frames.push(delta);
      elapsed += delta;
    }
    last = 1;
    if (elapsed >= SAMPLE_MS) {
      scene.events.off('postupdate', handler);
      finish(scene, frames);
    }
  };

  scene.events.on('postupdate', handler);
}

function finish(scene, frames) {
  if (frames.length === 0) return;
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const fps = 1000 / avg;
  const tier = fps < LITE_FPS_THRESHOLD ? 'lite' : 'full';
  scene.registry.set('quality', tier);
}
