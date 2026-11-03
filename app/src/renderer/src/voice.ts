/** Mono 16 kHz target for Muse Voice Transcribe. */
export const VOICE_SAMPLE_RATE = 16000

/**
 * Decode any recorded blob and render mono 16 kHz float samples.
 * Throws when the audio is empty or undecodable.
 */
export async function blobToMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer()
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(bytes.slice(0))
    if (decoded.duration <= 0 || decoded.length === 0) throw new Error('Empty audio')
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * VOICE_SAMPLE_RATE),
      VOICE_SAMPLE_RATE
    )
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    const rendered = await offline.startRendering()
    return rendered.getChannelData(0).slice()
  } finally {
    void ctx.close()
  }
}

/** Encode float samples as RIFF/WAVE mono 16-bit PCM. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buffer)
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) v.setUint8(offset + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  writeAscii(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}
