import { useEffect, useRef } from "react"
import { audioEngine } from "../../audio/engine"
import { useJarvis } from "../../state/store"
import {
  createOrbParticles,
  drawBars,
  drawGrid,
  drawOrb,
  drawReactor,
  drawWaveform,
  type VisualizerMode
} from "./visualizers"

interface Props {
  mode: VisualizerMode
  accent: string
  className?: string
}

/**
 * Canvas-based JARVIS visualiser.
 * Renders at device pixel ratio and reacts to the shared audio engine.
 */
export function JarvisVisualizer({ mode, accent, className }: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const state = useJarvis((s) => s.state)
  const particlesRef = useRef(createOrbParticles(240))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let raf = 0
    let width = 0
    let height = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const start = performance.now()

    const frame = (): void => {
      const elapsed = (performance.now() - start) / 1000
      const level = audioEngine.sample()
      const frequency = audioEngine.dominantBin()

      const visual = {
        ctx,
        width,
        height,
        time: elapsed,
        level,
        peak: audioEngine.peak,
        frequency,
        freq: audioEngine.getFrequencyData(),
        wave: audioEngine.getTimeDomainData(),
        speaking: state === "speaking",
        listening: state === "listening",
        accent,
        cyan: "#4fd6ff"
      }

      switch (mode) {
        case "reactor":
          drawReactor(visual)
          break
        case "bars":
          drawBars(visual)
          break
        case "waveform":
          drawWaveform(visual)
          break
        case "grid":
          drawGrid(visual)
          break
        case "orb":
        default:
          drawOrb(visual, particlesRef.current)
          break
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [mode, accent, state])

  return <canvas ref={canvasRef} className={className} />
}
