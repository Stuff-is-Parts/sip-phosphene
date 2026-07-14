# Contributing a scene

Community scenes are `.phos.json` files in `scenes/`. Merged scenes appear in
the hosted player automatically — no rebuild.

1. Make your scene in [the Studio](https://stuff-is-parts.github.io/sip-phosphene/studio.html)
   (or locally: `npm run dev`).
2. **EXPORT SCENE** → you get `your-scene.phos.json`.
3. Fork, add the file to `scenes/`, add its filename to `scenes/manifest.json`
   (or run `npm run scenes` locally to regenerate it), open a PR.

CI validates every layer of every scene (schema + WGSL parse through the real
assembly path). A green check means it loads; review is about taste, not syntax.

Ground rules: original work, nothing hateful, no attempts to fingerprint or
exfiltrate (scenes are pure WGSL + JSON — there's nowhere to hide code, and the
sandbox wouldn't run it anyway). Give your scene a unique name; names are the
dedupe key in the player.

## Ported scenes

Some scenes in `scenes/` are ports of Plane9 scenes by Joakim Dahl, released
under Creative Commons BY-NC-SA. Each such scene file carries `credit` and
`license` fields; those files remain under their original CC BY-NC-SA terms
(attribution, non-commercial, share-alike) independent of anything else in
this repository.
