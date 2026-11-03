import { useEffect, useRef, useState } from 'react'
import type { TranscribeErrorKind, TranscribeResult } from '../../shared/api'
import { blobToMono16k, encodeWavPcm16, VOICE_SAMPLE_RATE } from './voice'

export type MicPhase = 'idle' | 'requesting' | 'recording' | 'working'

/** Voice recordings auto-stop here and go to transcription. */
const MAX_VOICE_SECONDS = 60

const TRANSCRIBE_NOTICES: Record<TranscribeErrorKind, string> = {
  'no-speech': 'No speech detected — try again.',
  network: "Couldn't reach transcription — check your connection.",
  'rate-limited': 'Too many requests — wait a moment and try again.',
  api: 'Transcription failed — try again.'
}

export interface VoiceApi {
  micPhase: MicPhase
  micElapsed: number
  micError: string | null
  /** True when the mic notice needs an Open Settings action. */
  micDenied: boolean
  pressMic: () => void
}

export function formatVoiceElapsed(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

/**
 * Voice input (record, transcribe, append), shared by the chat and image
 * windows. Local-only, never the snapshot busy flag. The transcript goes
 * to onTranscript; this hook never touches the input itself.
 */
export function useVoice(opts: { onTranscript: (text: string) => void }): VoiceApi {
  const [micPhase, setMicPhaseState] = useState<MicPhase>('idle')
  const [micElapsed, setMicElapsed] = useState(0)
  const [micError, setMicError] = useState<string | null>(null)
  const [micDenied, setMicDenied] = useState(false)
  /** OS-level mic access already granted this session (skip the IPC round-trip). */
  const [micGranted, setMicGranted] = useState(false)
  const micPhaseRef = useRef<MicPhase>('idle')
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const micTimerRef = useRef<number | undefined>(undefined)
  const micCancelRef = useRef(false)
  const micStoppingRef = useRef(false)
  const micFailedRef = useRef(false)
  const onTranscriptRef = useRef(opts.onTranscript)
  onTranscriptRef.current = opts.onTranscript

  const setMicPhase = (p: MicPhase): void => {
    micPhaseRef.current = p
    setMicPhaseState(p)
  }

  /** Release the microphone immediately; safe to call twice. */
  const stopMicTracks = (): void => {
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((t) => t.stop())
  }

  /** Runs after the recorder stops: transcribe, unless this take was cancelled. */
  const finishRecording = async (): Promise<void> => {
    stopMicTracks()
    micStoppingRef.current = false
    const cancelled = micCancelRef.current
    const failed = micFailedRef.current
    const chunks = chunksRef.current
    chunksRef.current = []
    micFailedRef.current = false
    if (cancelled || micPhaseRef.current !== 'recording') {
      setMicPhase('idle')
      if (failed) setMicError("Couldn't process the recording — try again.")
      return
    }
    setMicPhase('working')
    try {
      const samples = await blobToMono16k(new Blob(chunks))
      if (samples.length === 0) throw new Error('Empty audio')
      window.api.chatTranscribe(new Uint8Array(encodeWavPcm16(samples, VOICE_SAMPLE_RATE)))
    } catch {
      setMicPhase('idle')
      setMicError("Couldn't process the recording — try again.")
    }
  }

  const stopRecording = (cancelled: boolean): void => {
    if (micPhaseRef.current !== 'recording' || micStoppingRef.current) return
    micCancelRef.current = cancelled
    micStoppingRef.current = true
    window.clearInterval(micTimerRef.current)
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    else {
      micStoppingRef.current = false
      stopMicTracks()
      chunksRef.current = []
      setMicPhase('idle')
    }
  }

  /** Phase must be 'requesting' when this runs (set by the mic press or access grant). */
  const startRecording = (): void => {
    setMicError(null)
    setMicDenied(false)
    setMicElapsed(0)
    micCancelRef.current = false
    micStoppingRef.current = false
    micFailedRef.current = false
    chunksRef.current = []
    void (async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        if (micPhaseRef.current !== 'requesting') return
        setMicPhase('idle')
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          setMicGranted(false)
          setMicDenied(true)
          setMicError('Microphone access is denied.')
        } else {
          setMicError("Couldn't start recording — try again.")
        }
        return
      }
      if (micPhaseRef.current !== 'requesting') {
        // Cancelled (Esc) while the browser prompt was open: release at once.
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (e: BlobEvent): void => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onerror = (): void => {
        micCancelRef.current = true
        micFailedRef.current = true
      }
      recorder.onstop = (): void => {
        void finishRecording()
      }
      const startedAt = Date.now()
      window.clearInterval(micTimerRef.current)
      micTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000)
        setMicElapsed(elapsed)
        if (elapsed >= MAX_VOICE_SECONDS) stopRecording(false)
      }, 250)
      recorder.start()
      setMicPhase('recording')
    })()
  }

  const pressMic = (): void => {
    if (micPhaseRef.current === 'recording') {
      stopRecording(false)
      return
    }
    if (micPhaseRef.current !== 'idle') return
    setMicError(null)
    setMicDenied(false)
    setMicPhase('requesting')
    if (micGranted) startRecording()
    else window.api.chatMicAccess()
  }

  const handleMicAccess = (result: { granted: boolean }): void => {
    if (micPhaseRef.current !== 'requesting') return
    if (result.granted) {
      setMicGranted(true)
      startRecording()
    } else {
      setMicPhase('idle')
      setMicDenied(true)
      setMicError('Microphone access is denied.')
    }
  }

  const handleTranscribed = (result: TranscribeResult): void => {
    if (micPhaseRef.current !== 'working') return
    setMicPhase('idle')
    if (result.ok) {
      onTranscriptRef.current(result.text)
    } else {
      setMicError(result.message ?? TRANSCRIBE_NOTICES[result.error])
    }
  }

  useEffect(() => {
    const offMicAccess = window.api.onMicAccessResult(handleMicAccess)
    const offTranscribed = window.api.onChatTranscribed(handleTranscribed)
    return () => {
      offMicAccess()
      offTranscribed()
      window.clearInterval(micTimerRef.current)
      stopMicTracks()
    }
  }, [])

  /** Esc cancels a recording (or a pending access request) without transcribing. */
  useEffect(() => {
    if (micPhase !== 'recording' && micPhase !== 'requesting') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (micPhaseRef.current === 'recording') stopRecording(true)
      else setMicPhase('idle')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [micPhase])

  return { micPhase, micElapsed, micError, micDenied, pressMic }
}
