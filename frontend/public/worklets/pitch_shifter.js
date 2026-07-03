class PitchShifterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.semitones = 0;
    this.port.onmessage = (e) => {
      if (e.data.semitones !== undefined)
        this.semitones = e.data.semitones;
    };
  }
  process(inputs, outputs) {
    const input = inputs[0][0];
    const output = outputs[0][0];
    if (!input) return true;
    const rate = Math.pow(2, this.semitones / 12);
    for (let i = 0; i < output.length; i++) {
      const srcIdx = Math.floor(i * rate) % input.length;
      output[i] = input[srcIdx] ?? 0;
    }
    return true;
  }
}
registerProcessor('pitch-shifter', PitchShifterProcessor);
