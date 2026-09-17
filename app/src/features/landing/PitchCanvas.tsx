import { useEffect, useRef, useState } from 'react'

/** Can this device run the 3D scene at all? */
function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * Fixed full-screen canvas behind the landing page. Three.js is loaded on
 * demand so the page text paints first; the gradient underneath is what shows
 * until (or instead of, without WebGL) the scene arrives.
 */
export function PitchCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !webglAvailable()) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let disposed = false
    let cleanup = () => {}

    import('./scene').then(({ createPitchScene }) => {
      if (disposed) return
      const scene = createPitchScene(canvas, { reducedMotion })
      setReady(true)

      const onPointer = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') return
        scene.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1))
      }
      const onResize = () => scene.resize()
      window.addEventListener('pointermove', onPointer, { passive: true })
      window.addEventListener('resize', onResize)

      cleanup = () => {
        window.removeEventListener('pointermove', onPointer)
        window.removeEventListener('resize', onResize)
        scene.dispose()
      }
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_70%,#0d3322_0%,#050706_65%)]">
      <canvas
        ref={canvasRef}
        className="h-full w-full transition-opacity duration-1000"
        style={{ opacity: ready ? 1 : 0 }}
      />
      {/* Keeps text legible over bright parts of the scene. */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(5_7_6/0.88)_0%,rgb(5_7_6/0.6)_45%,rgb(5_7_6/0.15)_100%)] max-md:bg-[linear-gradient(180deg,rgb(5_7_6/0.35)_0%,rgb(5_7_6/0.75)_100%)]" />
    </div>
  )
}
