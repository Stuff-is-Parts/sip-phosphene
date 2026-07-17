// AudioWorklet tap: forwards every audio block (both channels) to the main
// thread, where Analysis implements PCM::AddToBuffer exactly (see analysis.mjs).
// The worklet itself holds no state and outputs silence, so wiring it to the
// destination keeps it processing without affecting what you hear.
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.port.postMessage({ l: input[0].slice(0), r: input[1] ? input[1].slice(0) : null });
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
