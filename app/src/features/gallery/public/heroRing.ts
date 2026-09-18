/**
 * The public gallery's 3D hero: the team's most-loved photos hung on a slow
 * turning ring under stadium light, with volt dust drifting through it.
 *
 * GSAP flies the photos in on arrival; the pointer tilts the ring. With
 * reduced motion the ring is drawn once, still, and nothing animates.
 * Everything is disposed on unmount — this runs on phones.
 */

import * as THREE from 'three'
import { gsap } from 'gsap'

const RADIUS = 6.2
const CARD_H = 2.3

export interface RingPhoto {
  url: string
  aspect: number
}

export function createHeroRing(canvas: HTMLCanvasElement, photos: RingPhoto[]) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x050706, 9, 22)
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60)
  camera.position.set(0, 1.4, 14.5)

  const ring = new THREE.Group()
  ring.rotation.x = 0.06
  scene.add(ring)

  /* Photos on curved panels ------------------------------------------------ */
  const loader = new THREE.TextureLoader()
  loader.setCrossOrigin('anonymous')
  const disposables: { dispose: () => void }[] = []
  const cards: THREE.Mesh[] = []

  // Repeat the set so the ring is never sparse.
  const list = photos.length ? Array.from({ length: Math.max(photos.length, 10) }, (_, i) => photos[i % photos.length]) : []
  const step = (Math.PI * 2) / Math.max(list.length, 1)

  list.forEach((p, i) => {
    const w = CARD_H * Math.min(Math.max(p.aspect, 0.66), 1.8)
    const arc = w / RADIUS
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, CARD_H, 24, 1, true, -arc / 2, arc)
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a2b24, side: THREE.DoubleSide, transparent: true, opacity: 0 })
    loader.load(p.url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      mat.map = tex
      mat.color.set(0xffffff)
      mat.needsUpdate = true
      disposables.push(tex)
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.y = i * step
    mesh.position.y = (i % 2 ? 0.35 : -0.35) + Math.sin(i * 1.7) * 0.2
    ring.add(mesh)
    cards.push(mesh)
    disposables.push(geo, mat)
  })

  /* Volt dust --------------------------------------------------------------- */
  const DUST = 420
  const pos = new Float32Array(DUST * 3)
  for (let i = 0; i < DUST; i++) {
    const r = 2 + Math.random() * 10
    const a = Math.random() * Math.PI * 2
    pos[i * 3] = Math.cos(a) * r
    pos[i * 3 + 1] = (Math.random() - 0.5) * 8
    pos[i * 3 + 2] = Math.sin(a) * r
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const dustMat = new THREE.PointsMaterial({ color: 0xb4ff39, size: 0.045, transparent: true, opacity: 0.55, depthWrite: false })
  const dust = new THREE.Points(dustGeo, dustMat)
  scene.add(dust)
  disposables.push(dustGeo, dustMat)

  // A soft floor glow under the ring.
  const glowGeo = new THREE.CircleGeometry(RADIUS * 1.3, 48)
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x0f7b4f, transparent: true, opacity: 0.14 })
  const glow = new THREE.Mesh(glowGeo, glowMat)
  glow.rotation.x = -Math.PI / 2
  glow.position.y = -2.2
  scene.add(glow)
  disposables.push(glowGeo, glowMat)

  /* Sizing ------------------------------------------------------------------ */
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // Pull back on narrow screens so the ring still reads as a ring.
    camera.position.z = w < 640 ? 17 : 14.5
    // On wide screens the copy sits left, so the ring moves right of it.
    ring.position.x = w >= 1024 ? 4.2 : 0
    // On phones the copy fills the bottom, so the ring floats above it.
    ring.position.y = w >= 1024 ? 0 : 3.4
    dust.position.x = ring.position.x
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()

  /* Pointer tilt ------------------------------------------------------------ */
  const target = { x: 0, y: 0 }
  const onPointer = (e: PointerEvent) => {
    target.x = (e.clientX / window.innerWidth - 0.5) * 2
    target.y = (e.clientY / window.innerHeight - 0.5) * 2
  }
  window.addEventListener('pointermove', onPointer, { passive: true })

  /* Intro ------------------------------------------------------------------- */
  const intro = gsap.timeline()
  if (!reduced) {
    intro.from(camera.position, { z: 24, y: 5, duration: 2.2, ease: 'power3.out' }, 0)
    intro.from(ring.rotation, { y: -1.4, duration: 2.6, ease: 'power3.out' }, 0)
    cards.forEach((c, i) => {
      intro.to(c.material as THREE.MeshBasicMaterial, { opacity: 1, duration: 0.8, ease: 'power2.out' }, 0.25 + i * 0.06)
      intro.from(c.position, { y: c.position.y + (i % 2 ? 3 : -3), duration: 1.4, ease: 'expo.out' }, 0.2 + i * 0.06)
    })
  } else {
    cards.forEach((c) => ((c.material as THREE.MeshBasicMaterial).opacity = 1))
  }

  /* Loop -------------------------------------------------------------------- */
  let raf = 0
  let visible = true
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    if (visible && !reduced) loop()
  })
  io.observe(canvas)

  const clock = new THREE.Clock()
  const loop = () => {
    cancelAnimationFrame(raf)
    if (!visible) return
    const dt = Math.min(clock.getDelta(), 0.05)
    ring.rotation.y += dt * 0.07
    ring.rotation.x += (0.06 + target.y * 0.08 - ring.rotation.x) * 0.04
    camera.position.x += (target.x * 1.4 - camera.position.x) * 0.03
    camera.lookAt(ring.position.x * 0.55, 0, 0)
    dust.rotation.y -= dt * 0.02
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }

  if (reduced) {
    camera.lookAt(ring.position.x * 0.55, 0, 0)
    // Textures arrive async; redraw a few times so they appear.
    const redraw = setInterval(() => renderer.render(scene, camera), 400)
    setTimeout(() => clearInterval(redraw), 4000)
  } else loop()

  return () => {
    cancelAnimationFrame(raf)
    intro.kill()
    io.disconnect()
    ro.disconnect()
    window.removeEventListener('pointermove', onPointer)
    disposables.forEach((d) => d.dispose())
    renderer.dispose()
  }
}
