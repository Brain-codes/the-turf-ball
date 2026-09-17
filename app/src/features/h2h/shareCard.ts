/**
 * The downloadable head-to-head graphic.
 *
 * Drawn straight onto a canvas rather than screenshotting the page: the
 * result is identical on every phone, doesn't depend on the viewer's screen
 * size, and needs no extra library. 1080×1350 (4:5) is the size WhatsApp
 * status and Instagram both show uncropped.
 */

export interface CardPlayer {
  name: string
  team: string
  position: string | null
  photoUrl: string | null
}

export interface CardRow {
  label: string
  a: number
  b: number
  /** 'a' | 'b' | null (a draw) */
  winner: 'a' | 'b' | null
  decimals?: boolean
}

export interface CardInput {
  a: CardPlayer
  b: CardPlayer
  score: { a: number; b: number }
  rows: CardRow[]
  link: string
}

const W = 1080
const H = 1350

const C = {
  void: '#050706',
  pitch900: '#0b1210',
  pitch800: '#111c18',
  pitch700: '#1a2b24',
  volt: '#b4ff39',
  chalk: '#f4f7f5',
  muted: '#8a9691',
  faint: '#566159',
}

const DISPLAY = '"Space Grotesk", system-ui, sans-serif'
const NUMERIC = '"Bebas Neue", "Space Grotesk", sans-serif'
const SANS = 'Inter, system-ui, sans-serif'

/** Photos come from public Storage; a failed load (CORS, 404) falls back to initials. */
function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

/** Shrinks text until it fits `maxWidth`, then ellipsises as a last resort. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: (size: number) => string, size: number, min: number) {
  let s = size
  ctx.font = font(s)
  while (ctx.measureText(text).width > maxWidth && s > min) {
    s -= 2
    ctx.font = font(s)
  }
  let t = text
  while (ctx.measureText(t).width > maxWidth && t.length > 1) t = t.slice(0, -1)
  return t === text ? t : `${t.slice(0, -1)}…`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, C.pitch800)
  bg.addColorStop(0.55, C.pitch900)
  bg.addColorStop(1, C.void)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Mown-grass stripes.
  ctx.fillStyle = 'rgba(255,255,255,0.018)'
  for (let x = 0; x < W; x += 180) ctx.fillRect(x, 0, 90, H)

  // Pitch markings: halfway line and centre circle behind the players.
  ctx.strokeStyle = 'rgba(244,247,245,0.06)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(W / 2, 0)
  ctx.lineTo(W / 2, 520)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(W / 2, 330, 190, 0, Math.PI * 2)
  ctx.stroke()

  // Volt glow at the top.
  const glow = ctx.createRadialGradient(W / 2, 300, 20, W / 2, 300, 560)
  glow.addColorStop(0, 'rgba(180,255,57,0.16)')
  glow.addColorStop(1, 'rgba(180,255,57,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, 800)
}

function drawAvatar(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, name: string, cx: number, cy: number, r: number, winner: boolean) {
  ctx.save()
  if (winner) {
    ctx.shadowColor = 'rgba(180,255,57,0.55)'
    ctx.shadowBlur = 40
  }
  ctx.beginPath()
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2)
  ctx.fillStyle = winner ? C.volt : C.pitch700
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = C.pitch700
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  if (img) {
    // Cover-fit the photo into the circle.
    const scale = Math.max((r * 2) / img.width, (r * 2) / img.height)
    const w = img.width * scale
    const h = img.height * scale
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h)
  } else {
    ctx.fillStyle = C.muted
    ctx.font = `700 ${r * 0.75}px ${DISPLAY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initials(name), cx, cy + 4)
  }
  ctx.restore()
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: CardPlayer, img: HTMLImageElement | null, cx: number, winner: boolean) {
  drawAvatar(ctx, img, p.name, cx, 320, 118, winner)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.chalk
  const name = fitText(ctx, p.name, 380, (s) => `700 ${s}px ${DISPLAY}`, 48, 28)
  ctx.fillText(name, cx, 520)

  ctx.fillStyle = C.muted
  const sub = p.position ? `${p.team} · ${p.position.toUpperCase()}` : p.team
  ctx.fillText(fitText(ctx, sub, 380, (s) => `500 ${s}px ${SANS}`, 26, 18), cx, 562)
}

function drawRows(ctx: CanvasRenderingContext2D, rows: CardRow[], top: number, bottom: number) {
  const left = 70
  const right = W - 70
  const rowH = (bottom - top) / rows.length
  const barMax = 210
  const inner = 150 // gap either side of the centre label

  rows.forEach((row, i) => {
    const y = top + i * rowH
    const mid = y + rowH / 2

    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.025)'
      roundRect(ctx, left - 20, y + 4, right - left + 40, rowH - 8, 18)
      ctx.fill()
    }

    // Bars sit on the same line as their numbers, growing outward from the
    // centre label towards each player's value.
    const max = Math.max(row.a, row.b)
    const barH = 12
    const barY = mid - barH / 2
    for (const side of ['a', 'b'] as const) {
      const len = max > 0 ? (row[side] / max) * barMax : 0
      ctx.fillStyle = C.pitch700
      roundRect(ctx, side === 'a' ? W / 2 - inner - barMax : W / 2 + inner, barY, barMax, barH, 6)
      ctx.fill()
      if (len > 0) {
        ctx.fillStyle = row.winner === side ? C.volt : C.faint
        roundRect(ctx, side === 'a' ? W / 2 - inner - len : W / 2 + inner, barY, len, barH, 6)
        ctx.fill()
      }
    }

    const fmt = (v: number) => (row.decimals ? v.toFixed(2) : String(v))
    ctx.textBaseline = 'middle'
    ctx.font = `64px ${NUMERIC}`
    ctx.fillStyle = row.winner === 'a' ? C.volt : C.chalk
    ctx.textAlign = 'left'
    ctx.fillText(fmt(row.a), left, mid + 3)
    ctx.fillStyle = row.winner === 'b' ? C.volt : C.chalk
    ctx.textAlign = 'right'
    ctx.fillText(fmt(row.b), right, mid + 3)

    ctx.textAlign = 'center'
    ctx.fillStyle = C.muted
    ctx.font = `600 21px ${SANS}`
    ctx.fillText(row.label.toUpperCase(), W / 2, mid + 1)
  })
}

export async function renderShareCard(input: CardInput): Promise<Blob> {
  // Canvas silently falls back to a system font if the web font isn't ready.
  await Promise.all([
    document.fonts.load(`60px "Bebas Neue"`),
    document.fonts.load(`700 48px "Space Grotesk"`),
    document.fonts.load(`600 24px Inter`),
  ]).catch(() => undefined)

  const [imgA, imgB] = await Promise.all([loadImage(input.a.photoUrl), loadImage(input.b.photoUrl)])

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  drawBackground(ctx)

  // Header.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.volt
  ctx.font = `600 24px ${SANS}`
  ctx.fillText('⚽  THE TURF BALL', W / 2, 78)
  ctx.fillStyle = C.chalk
  ctx.font = `92px ${NUMERIC}`
  ctx.fillText('HEAD TO HEAD', W / 2, 168)

  const aLeads = input.score.a > input.score.b
  const bLeads = input.score.b > input.score.a
  drawPlayer(ctx, input.a, imgA, 250, aLeads)
  drawPlayer(ctx, input.b, imgB, W - 250, bLeads)

  // Centre score.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `110px ${NUMERIC}`
  ctx.fillStyle = aLeads ? C.volt : C.chalk
  ctx.fillText(String(input.score.a), W / 2 - 52, 320)
  ctx.fillStyle = bLeads ? C.volt : C.chalk
  ctx.fillText(String(input.score.b), W / 2 + 52, 320)
  ctx.fillStyle = C.faint
  ctx.fillText('-', W / 2, 316)
  ctx.font = `600 18px ${SANS}`
  ctx.fillStyle = C.muted
  ctx.fillText('CATEGORIES WON', W / 2, 396)

  drawRows(ctx, input.rows, 610, 1210)

  // Footer: a short, readable address. The full link (with the two player
  // ids) travels in the caption; this is the fallback if the caption is lost.
  ctx.fillStyle = C.pitch700
  ctx.fillRect(70, 1238, W - 140, 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.muted
  ctx.font = `500 22px ${SANS}`
  ctx.fillText('Compare any two players at', W / 2, 1282)
  ctx.fillStyle = C.volt
  ctx.font = `700 34px ${DISPLAY}`
  const url = new URL(input.link)
  ctx.fillText(`${url.host.replace(/^www\./, '')}${url.pathname}`, W / 2, 1326)

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'),
  )
}
