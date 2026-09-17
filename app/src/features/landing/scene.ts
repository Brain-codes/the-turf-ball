/**
 * The landing page's 3D world: a floodlit pitch at night.
 *
 * One fixed canvas sits behind the whole page. Scroll progress (0 → 1) is fed
 * in from GSAP and drives a camera path around the pitch plus a single ball
 * that travels from the centre spot into the net and back. Everything else
 * (drifting dust, a slow ball spin, pointer parallax) is ambient and subtle —
 * the page copy has to stay the thing you read.
 */

import * as THREE from 'three'

type Key = { at: number; pos: [number, number, number]; look: [number, number, number] }

// Camera path. Each key lines up with a section of the page.
const CAMERA_KEYS: Key[] = [
  { at: 0.0, pos: [0, 1.6, 5.2], look: [0, 0.5, 0] },       // hero — ball on the centre spot
  { at: 0.12, pos: [-7, 7, 9], look: [0, 0, -1] },          // the problem
  { at: 0.26, pos: [0, 38, 0.1], look: [0, 0, 0] },          // how it works — tactics board
  { at: 0.42, pos: [9, 4.5, -12], look: [0, 0.6, -22] },     // match day — build-up
  { at: 0.56, pos: [0, 2.6, -17], look: [0, 1, -28] },       // scoring — ball hits the net
  { at: 0.7, pos: [-16, 14, -6], look: [0, 0, -8] },         // table + awards
  { at: 0.84, pos: [12, 8, 16], look: [0, 0, 2] },           // sharing
  { at: 1.0, pos: [0, 16, 34], look: [0, 0, 0] },            // final call — whole pitch
]

const PITCH_W = 40
const PITCH_L = 60
const GOAL_Z = -28
const GOAL_W = 5.2
const GOAL_H = 1.9
const BALL_R = 0.32

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

function pitchTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 768
  const g = c.getContext('2d')!
  const sx = c.width / PITCH_W
  const sz = c.height / PITCH_L

  // Mowing stripes.
  const stripes = 14
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#0b2a1d' : '#0d3322'
    g.fillRect(0, (i * c.height) / stripes, c.width, c.height / stripes + 1)
  }

  // Floodlight pools, baked in — far cheaper than four real spotlights.
  const pools: [number, number][] = [[-9, -12], [9, -12], [-9, 12], [9, 12], [0, 0]]
  for (const [px, pz] of pools) {
    const cx = (px + PITCH_W / 2) * sx
    const cz = (pz + PITCH_L / 2) * sz
    const r = 26 * sx
    const pool = g.createRadialGradient(cx, cz, 0, cx, cz, r)
    pool.addColorStop(0, 'rgba(200,255,150,0.16)')
    pool.addColorStop(1, 'rgba(200,255,150,0)')
    g.fillStyle = pool
    g.fillRect(0, 0, c.width, c.height)
  }

  // Markings, in pitch units converted to pixels.
  const X = (x: number) => (x + PITCH_W / 2) * sx
  const Z = (z: number) => (z + PITCH_L / 2) * sz
  g.strokeStyle = 'rgba(244,247,245,0.75)'
  g.lineWidth = 2.2
  const halfW = PITCH_W / 2 - 2
  const halfL = -GOAL_Z
  g.strokeRect(X(-halfW), Z(-halfL), X(halfW) - X(-halfW), Z(halfL) - Z(-halfL))
  g.beginPath(); g.moveTo(X(-halfW), Z(0)); g.lineTo(X(halfW), Z(0)); g.stroke()
  g.beginPath(); g.arc(X(0), Z(0), 5 * sx, 0, Math.PI * 2); g.stroke()
  g.fillStyle = 'rgba(244,247,245,0.8)'
  g.beginPath(); g.arc(X(0), Z(0), 3, 0, Math.PI * 2); g.fill()
  for (const dir of [-1, 1]) {
    const line = dir * halfL
    g.strokeRect(X(-11), Math.min(Z(line), Z(line - dir * 9)), X(11) - X(-11), Math.abs(Z(line - dir * 9) - Z(line)))
    g.strokeRect(X(-5), Math.min(Z(line), Z(line - dir * 3.5)), X(5) - X(-5), Math.abs(Z(line - dir * 3.5) - Z(line)))
    g.beginPath(); g.arc(X(0), Z(line - dir * 6.5), 2.5, 0, Math.PI * 2); g.fill()
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#f4f7f5'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#0b1210'
  // Scattered pentagon panels in equirectangular space — reads as a classic ball.
  const spots: [number, number, number][] = [
    [256, 128, 30], [96, 128, 30], [416, 128, 30],
    [176, 50, 22], [336, 50, 22], [16, 50, 22], [496, 50, 22],
    [176, 206, 22], [336, 206, 22], [16, 206, 22], [496, 206, 22],
    [256, 8, 60], [256, 248, 60],
  ]
  for (const [x, y, r] of spots) {
    g.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.9)
    }
    g.closePath()
    g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(230,255,200,0.6)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

function buildGoal(): THREE.Group {
  const goal = new THREE.Group()
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf4f7f5, roughness: 0.4, emissive: 0x222222 })
  const post = new THREE.CylinderGeometry(0.07, 0.07, GOAL_H, 12)
  for (const x of [-GOAL_W / 2, GOAL_W / 2]) {
    const m = new THREE.Mesh(post, postMat)
    m.position.set(x, GOAL_H / 2, 0)
    goal.add(m)
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, GOAL_W + 0.14, 12), postMat)
  bar.rotation.z = Math.PI / 2
  bar.position.y = GOAL_H
  goal.add(bar)

  // Net: a grid of lines on the back and sides.
  const pts: number[] = []
  const depth = 1.8
  const step = 0.3
  for (let x = -GOAL_W / 2; x <= GOAL_W / 2 + 0.001; x += step) {
    pts.push(x, 0, -depth, x, GOAL_H, -depth)
    pts.push(x, GOAL_H, 0, x, GOAL_H, -depth)
  }
  for (let y = 0; y <= GOAL_H + 0.001; y += step) {
    pts.push(-GOAL_W / 2, y, -depth, GOAL_W / 2, y, -depth)
    pts.push(-GOAL_W / 2, y, 0, -GOAL_W / 2, y, -depth)
    pts.push(GOAL_W / 2, y, 0, GOAL_W / 2, y, -depth)
  }
  for (let z = 0; z >= -depth - 0.001; z -= step) {
    pts.push(-GOAL_W / 2, 0, z, -GOAL_W / 2, GOAL_H, z)
    pts.push(GOAL_W / 2, 0, z, GOAL_W / 2, GOAL_H, z)
    pts.push(-GOAL_W / 2, GOAL_H, z, GOAL_W / 2, GOAL_H, z)
  }
  const netGeo = new THREE.BufferGeometry()
  netGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  const net = new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: 0xdfe8e3, transparent: true, opacity: 0.28 }))
  net.name = 'net'
  goal.add(net)
  return goal
}

export type PitchScene = {
  setProgress: (p: number) => void
  setPointer: (x: number, y: number) => void
  resize: () => void
  dispose: () => void
}

export function createPitchScene(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean }): PitchScene {
  const small = window.innerWidth < 768
  const dpr = Math.min(window.devicePixelRatio, small ? 1.25 : 1.5)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 1.5, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(dpr)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.setClearColor(0x050706)

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x050706, 0.022)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200)

  // Light: dim moonlight + four floodlights.
  scene.add(new THREE.HemisphereLight(0xcfeedd, 0x0b1210, 1.6))
  const key = new THREE.DirectionalLight(0xe8fff0, 1.1)
  key.position.set(-10, 20, 12)
  scene.add(key)

  const glow = glowTexture()
  const towers: [number, number][] = [[-24, -32], [24, -32], [-24, 32], [24, 32]]
  for (const [x, z] of towers) {
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.25, 18, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a2b24, roughness: 0.8 }),
    )
    mast.position.set(x, 9, z)
    scene.add(mast)

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xeaffd6, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
    sprite.position.set(x, 18.2, z)
    sprite.scale.setScalar(9)
    scene.add(sprite)

    // Visible beam of light hanging in the haze.
    const beamGeo = new THREE.ConeGeometry(7, 20, 16, 1, true)
    beamGeo.translate(0, -10, 0)
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xc8ff70, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    beam.position.set(x, 18, z)
    beam.lookAt(x * 0.2, 0, z * 0.3)
    beam.rotateX(-Math.PI / 2)
    scene.add(beam)
  }

  // Pitch + a darker surround so the markings float in the dark.
  const pitchTex = pitchTexture()
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_W, PITCH_L),
    new THREE.MeshLambertMaterial({ map: pitchTex }),
  )
  pitch.rotation.x = -Math.PI / 2
  scene.add(pitch)
  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshBasicMaterial({ color: 0x050b08 }),
  )
  surround.rotation.x = -Math.PI / 2
  surround.position.y = -0.01
  scene.add(surround)

  const goalFar = buildGoal()
  goalFar.position.z = GOAL_Z
  scene.add(goalFar)
  const goalNear = buildGoal()
  goalNear.position.z = -GOAL_Z
  goalNear.rotation.y = Math.PI
  scene.add(goalNear)
  const net = goalFar.getObjectByName('net') as THREE.LineSegments

  // The ball, with a soft contact shadow.
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 48, 32),
    new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45, metalness: 0.05 }),
  )
  scene.add(ball)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(BALL_R * 1.3, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.01
  scene.add(shadow)

  // A faint volt ring that pulses under the ball on the hero.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.6, 64),
    new THREE.MeshBasicMaterial({ color: 0xb4ff39, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.02
  scene.add(ring)

  // Dust in the floodlights.
  const dustCount = small ? 200 : 450
  const dustPos = new Float32Array(dustCount * 3)
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 60
    dustPos[i * 3 + 1] = Math.random() * 16
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 80
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glow, size: 0.18, color: 0xdfffc0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }))
  scene.add(dust)

  // --- State -----------------------------------------------------------------
  let target = 0
  let progress = 0
  const pointer = new THREE.Vector2()
  const sway = new THREE.Vector2()
  const camPos = new THREE.Vector3()
  const camLook = new THREE.Vector3()
  const wantPos = new THREE.Vector3()
  const wantLook = new THREE.Vector3()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const heroShift = new THREE.Vector3()

  function sampleCamera(p: number) {
    let i = 0
    while (i < CAMERA_KEYS.length - 2 && p > CAMERA_KEYS[i + 1].at) i++
    const k0 = CAMERA_KEYS[i]
    const k1 = CAMERA_KEYS[i + 1]
    const t = smooth(clamp01((p - k0.at) / (k1.at - k0.at)))
    wantPos.copy(a.fromArray(k0.pos)).lerp(b.fromArray(k1.pos), t)
    wantLook.copy(a.fromArray(k0.look)).lerp(b.fromArray(k1.look), t)
    // On the hero, frame the ball clear of the headline: to the right on wide
    // screens, above the bottom-aligned copy on phones. Fades out on scroll.
    const hero = 1 - smooth(clamp01(p / 0.1))
    heroShift.set(0, 0, 0)
    if (camera.aspect >= 1) heroShift.x = -2.1
    else heroShift.y = -1.5
    heroShift.multiplyScalar(hero)
    wantPos.add(heroShift)
    wantLook.add(heroShift)
    if (camera.aspect < 1) wantPos.z += 2.5 * hero
  }

  function ballAt(p: number, out: THREE.Vector3) {
    const start = new THREE.Vector3(0, BALL_R, 0)
    const end = new THREE.Vector3(0.9, 0.95, GOAL_Z - 1.1)
    if (p < 0.34) return out.copy(start)
    if (p < 0.55) {
      // The strike: a rising, dipping arc into the top corner.
      const t = smooth((p - 0.34) / 0.21)
      out.lerpVectors(start, end, t)
      out.y += Math.sin(t * Math.PI) * 3.2
      return out
    }
    if (p < 0.8) return out.copy(end)
    const t = smooth(clamp01((p - 0.8) / 0.12))
    return out.lerpVectors(new THREE.Vector3(end.x, BALL_R, end.z + 1.6), start, t)
  }

  resize()

  const clock = new THREE.Clock()
  let raf = 0
  let running = true
  const ballPos = new THREE.Vector3()
  let lastBall = new THREE.Vector3(0, BALL_R, 0)
  let netKick = 0
  let prevProgress = 0

  function frame() {
    if (!running) return
    raf = requestAnimationFrame(frame)
    const dt = Math.min(clock.getDelta(), 0.05)
    const time = clock.elapsedTime

    // Scroll position is read in the same frame it's drawn, and applied
    // directly — the camera is exactly where the page is, never catching up.
    const max = document.documentElement.scrollHeight - window.innerHeight
    progress = max > 0 ? clamp01(window.scrollY / max) : target
    sampleCamera(progress)
    // Only the mouse sway is eased, and it's small.
    if (!opts.reducedMotion) sway.lerp(pointer, Math.min(1, dt * 3))
    camPos.copy(wantPos)
    camPos.x += sway.x * 0.6
    camPos.y += sway.y * 0.3
    camLook.copy(wantLook)
    camera.position.copy(camPos)
    camera.lookAt(camLook)

    ballAt(progress, ballPos)
    const moved = ballPos.distanceTo(lastBall)
    ball.position.copy(ballPos)
    if (!opts.reducedMotion) {
      ball.rotation.x -= moved / BALL_R + (progress < 0.34 ? dt * 0.25 : 0)
      ball.rotation.y += progress < 0.34 ? dt * 0.35 : 0
      if (progress < 0.34) ball.position.y = BALL_R + Math.abs(Math.sin(time * 1.6)) * 0.06
    }
    lastBall = ballPos.clone()
    shadow.position.set(ballPos.x, 0.01, ballPos.z)
    const h = Math.max(0, ball.position.y - BALL_R)
    shadow.scale.setScalar(1 + h * 0.4)
    ;(shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 / (1 + h)

    ;(ring.material as THREE.MeshBasicMaterial).opacity = (1 - clamp01(progress / 0.1)) * (0.35 + Math.sin(time * 2) * 0.15)
    ring.scale.setScalar(1 + ((time * 0.5) % 1) * 0.6)

    // Ripple the net when the ball arrives.
    if (prevProgress < 0.55 && progress >= 0.55) netKick = 1
    prevProgress = progress
    netKick *= 0.94
    net.scale.z = 1 + netKick * 0.25 * Math.sin(time * 18)
    ;(net.material as THREE.LineBasicMaterial).opacity = 0.28 + netKick * 0.4

    if (!opts.reducedMotion) {
      dust.rotation.y = time * 0.01
      dust.position.y = Math.sin(time * 0.2) * 0.3
    }

    renderer.render(scene, camera)
  }

  function resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // Pull back a little on tall phone screens so the pitch still fills the frame.
    camera.fov = w / h < 0.8 ? 62 : 50
    camera.updateProjectionMatrix()
  }

  function onVisibility() {
    if (document.hidden) {
      running = false
      cancelAnimationFrame(raf)
    } else if (!running) {
      running = true
      clock.getDelta()
      frame()
    }
  }

  resize()
  frame()
  document.addEventListener('visibilitychange', onVisibility)

  return {
    setProgress: (p) => { target = clamp01(p) },
    setPointer: (x, y) => { pointer.set(x, y) },
    resize,
    dispose: () => {
      running = false
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        mesh.geometry?.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      })
      pitchTex.dispose()
      glow.dispose()
      renderer.dispose()
    },
  }
}
