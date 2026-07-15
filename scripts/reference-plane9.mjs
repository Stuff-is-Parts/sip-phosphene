// Native Plane9 reference captures from the installed application
// (COMPATIBILITY-GOAL.md Plan step 3 — Plane9 reference fixtures).
//
// Method: Plane9's record-a-movie mode writes RGB frames to an output
// container at a controlled resolution/FPS with an mp3 supplying the
// sound spectrum. The command-line surface is witnessed in the engine
// DLL string dump (fixtures/plane9/engine-dll-strings.txt) via the
// `moviefile`, `filename`, `recordfps`, `rttscale`, `motionblursteps`,
// `motionblur`, `transitiontime`, `sceneminruntime`, `scenemaxruntime`,
// and mp3/randomize/recordtime option names, plus the run-mode switches
// `movie` (record) and `windowed` (surfaces a rendering window).
//
// This script builds per-scene single-item playlists (Plane9 native
// playlist format witnessed at C:\Program Files (x86)\Plane9\playlists\
// default.p9p) with committed Record parameters, invokes Plane9 in
// record mode against each, and stores the resulting movie plus a
// manifest recording exact fixture parameters. Frames extracted from
// the movie files at committed indices become the validation oracle;
// the extraction is a separate step (ffmpeg) documented in the manifest.
//
// The one runtime input this script cannot commit deterministically is
// music (Plane9 reads the spectrum from playback / a supplied mp3). A
// silent-mp3 fixture is committed at reference/plane9/silence.mp3 so
// audio-reactive scenes see a defined zero-spectrum baseline; this is
// documented in the manifest so it is not confused with silence-because-
// bug behavior.
//
// Usage: node scripts/reference-plane9.mjs [maxScenes]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const PLANE9_EXE = String.raw`C:\Program Files (x86)\Plane9\Plane9.exe`;
const SCENES_ROOT = String.raw`scenes/plane9/scenes`;
const REF_ROOT = "reference/plane9";
const SILENCE_MP3 = join(REF_ROOT, "silence.mp3");

// Committed capture parameters (baked into every fixture; the manifest
// records these verbatim). Chosen conservatively:
// - 800x600: matches the milk fixture resolution for consistent SSIM;
// - 30 FPS: matches the shared deterministic-frame convention;
// - 10 seconds per scene: covers Plane9 warmup + several beats of state;
// - motion blur off: single-sample deterministic frame contents;
// - scene run/transition times pinned so exactly one scene renders.
const FIXTURE = {
  width: 800, height: 600, fps: 30, seconds: 10,
  rttScale: 1, motionBlur: 0, motionBlurSteps: 1,
  transitionTime: 0, sceneMinRuntime: 999, sceneMaxRuntime: 999,
};

if (!existsSync(PLANE9_EXE)) {
  console.error(`Plane9 not found at ${PLANE9_EXE}`);
  process.exit(1);
}
if (!existsSync(SILENCE_MP3)) {
  console.error(`silent-audio fixture missing: ${SILENCE_MP3}\n` +
    `create it once (deterministic silent mp3, 30s @ 44100 Hz mono):\n` +
    `  ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 30 -codec:a libmp3lame ` +
    `${SILENCE_MP3}`);
  process.exit(1);
}

const maxScenes = parseInt(process.argv[2] ?? "50", 10);

const p9cFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith(".p9c")) p9cFiles.push(p);
  }
})(SCENES_ROOT);
p9cFiles.sort();
const step = Math.max(1, Math.floor(p9cFiles.length / Math.min(maxScenes, p9cFiles.length)));
const selected = [];
for (let i = 0; i < p9cFiles.length && selected.length < maxScenes; i += step) selected.push(p9cFiles[i]);
console.log(`p9c files: ${p9cFiles.length}, capturing: ${selected.length}`);

mkdirSync(REF_ROOT, { recursive: true });
mkdirSync(join(REF_ROOT, "playlists"), { recursive: true });
mkdirSync(join(REF_ROOT, "movies"), { recursive: true });

const slugOf = (p) => relative(SCENES_ROOT, p).replace(/\.p9c$/i, "")
  .replace(/[^\w\- ]+/g, "").trim().replace(/[\s\\/]+/g, "_").slice(0, 90);

const manifest = { fixture: FIXTURE, silenceAudio: SILENCE_MP3, scenes: [] };
for (const p9c of selected) {
  const slug = slugOf(p9c);
  const absScene = resolve(p9c);
  const playlistPath = join(REF_ROOT, "playlists", `${slug}.p9p`);
  const moviePath = join(REF_ROOT, "movies", `${slug}.mp4`);
  // Single-scene playlist: Plane9 loads the top item and stays there
  // until sceneMinRuntime/sceneMaxRuntime tell it to switch.
  const playlist = `<?xml version="1.0" encoding="UTF-8"?>
<Plane9>
    <Playlist ActiveSceneFile="${absScene}" StudioPlaylist="0"/>
    <Record Width="${FIXTURE.width}" Height="${FIXTURE.height}" FPS="${FIXTURE.fps}" ScreenScale="1" MusicFile="${resolve(SILENCE_MP3)}" OutputFile="${resolve(moviePath)}"/>
    <Scenes>
        <Scene File="${absScene}"/>
    </Scenes>
</Plane9>
`;
  writeFileSync(playlistPath, playlist);
  const args = [
    "-movie",
    "-filename", resolve(playlistPath),
    "-moviefile", resolve(moviePath),
    "-w", String(FIXTURE.width),
    "-h", String(FIXTURE.height),
    "-rttscale", String(FIXTURE.rttScale),
    "-recordfps", String(FIXTURE.fps),
    "-recordtime", String(FIXTURE.seconds),
    "-motionblur", String(FIXTURE.motionBlur),
    "-motionblursteps", String(FIXTURE.motionBlurSteps),
    "-transitiontime", String(FIXTURE.transitionTime),
    "-sceneminruntime", String(FIXTURE.sceneMinRuntime),
    "-scenemaxruntime", String(FIXTURE.sceneMaxRuntime),
    "-song", resolve(SILENCE_MP3),
  ];
  console.log(`[${manifest.scenes.length + 1}/${selected.length}] ${slug}`);
  try {
    // Movie mode exits on its own after `recordtime` seconds (witnessed
    // string: "Time in seconds to record before auto quiting").
    execFileSync(PLANE9_EXE, args, {
      timeout: (FIXTURE.seconds + 60) * 1000,
      stdio: "inherit",
    });
    const status = existsSync(moviePath) ? "captured" : "no-output";
    manifest.scenes.push({
      source: relative(process.cwd(), p9c), slug, playlist: playlistPath,
      movie: moviePath, status,
    });
  } catch (err) {
    manifest.scenes.push({
      source: relative(process.cwd(), p9c), slug,
      status: "capture-failed", error: String(err.message).slice(0, 200),
    });
    console.error(`  failed: ${String(err.message).slice(0, 120)}`);
  }
}

writeFileSync(join(REF_ROOT, "manifest.json"), JSON.stringify({
  renderer: "Plane9 " + "(installed)" + " — record-mode native capture",
  cli: "moviefile/filename/recordfps/rttscale/motionblur/motionblursteps/transitiontime/sceneminruntime/scenemaxruntime/song witnessed in engine DLL string table",
  fixture: FIXTURE,
  silenceAudio: SILENCE_MP3,
  extraction: "extract PNG frames at committed indices with ffmpeg: " +
    `ffmpeg -i <movie> -vf 'select=eq(n\\,{f})' -vframes 1 <out>-<f>.png`,
  scenes: manifest.scenes,
}, null, 2));
console.log(`\ncaptured ${manifest.scenes.filter((s) => s.status === "captured").length}/${manifest.scenes.length}`);
console.log(`manifest: ${REF_ROOT}/manifest.json`);
