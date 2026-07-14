/** WebMIDI: first four distinct CCs seen are auto-learned to midi1..midi4. */

export const midiLevels = new Float32Array(4);
const learned: number[] = [];
let started = false;

export function midiSlots(): { cc: number; slot: number }[] {
  return learned.map((cc, slot) => ({ cc, slot }));
}

export async function startMidi(onLearn?: (cc: number, slot: number) => void): Promise<boolean> {
  if (started) return true;
  if (!("requestMIDIAccess" in navigator)) return false;
  try {
    const access = await navigator.requestMIDIAccess();
    const hook = (input: MIDIInput) => {
      input.onmidimessage = (e: MIDIMessageEvent) => {
        const d = e.data;
        if (!d || d.length < 3) return;
        const status = d[0] & 0xf0;
        if (status !== 0xb0) return; // control change only
        const cc = d[1];
        let slot = learned.indexOf(cc);
        if (slot === -1 && learned.length < 4) {
          learned.push(cc);
          slot = learned.length - 1;
          onLearn?.(cc, slot);
        }
        if (slot >= 0) midiLevels[slot] = d[2] / 127;
      };
    };
    access.inputs.forEach(hook);
    access.onstatechange = (e) => {
      const p = e.port;
      if (p && p.type === "input" && p.state === "connected") hook(p as MIDIInput);
    };
    started = true;
    return true;
  } catch {
    return false;
  }
}
