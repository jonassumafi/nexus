class BitCrusherProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bitDepth = 16;
    this.port.onmessage = (e) => {
      if (e.data.bitDepth !== undefined)
        this.bitDepth = e.data.bitDepth;
    };
  }
  process(inputs, outputs) {
    const input = inputs[0][0];
    const output = outputs[0][0];
    if (!input) return true;
    const step = Math.pow(0.5, this.bitDepth - 1);
    for (let i = 0; i < input.length; i++) {
      output[i] = Math.round(input[i] / step) * step;
    }
    return true;
  }
}
registerProcessor('bit-crusher', BitCrusherProcessor);
