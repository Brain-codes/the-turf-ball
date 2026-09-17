import { useEffect, useId, useRef, useState } from 'react'
import { RiDeleteBinLine, RiImageAddLine } from '@remixicon/react'
import { compressImage } from '@/lib/file'

/**
 * Optional group logo. Hands back a small WebP data URL (keeps transparent
 * badges transparent), or null when the logo is removed.
 */
export function LogoPicker({
  currentUrl,
  onChange,
  name,
}: {
  currentUrl?: string | null
  onChange: (value: { dataUrl: string } | { removed: true } | null) => void
  name?: string
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setPreview(currentUrl ?? null), [currentUrl])

  const pick = async (file: File | undefined) => {
    setError(null)
    if (!file) return
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('Use a JPEG, PNG or WebP image.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('That image is too large. Pick one under 10MB.')
      return
    }
    try {
      const dataUrl = await compressImage(file, { maxDimension: 400, type: 'image/webp' })
      setPreview(dataUrl)
      onChange({ dataUrl })
    } catch {
      setError('That image could not be read. Try another one.')
    }
  }

  const remove = () => {
    setPreview(null)
    if (input.current) input.current.value = ''
    onChange(currentUrl ? { removed: true } : null)
  }

  const initials = (name ?? '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-chalk-muted">
        Logo or badge <span className="font-normal text-chalk-faint">(optional)</span>
      </p>
      <div className="flex items-center gap-4">
        <label
          htmlFor={id}
          className="group relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-pitch-600 bg-pitch-900 transition-colors hover:border-volt-400/60"
        >
          {preview ? (
            <img src={preview} alt="Group logo preview" className="h-full w-full object-cover" />
          ) : initials ? (
            <span className="font-display text-xl font-bold text-chalk-faint">{initials}</span>
          ) : (
            <RiImageAddLine className="h-7 w-7 text-chalk-faint" />
          )}
        </label>
        <div className="flex flex-col items-start gap-1.5">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="min-h-11 rounded-lg border border-pitch-600 px-3.5 text-[14px] text-chalk transition-colors hover:border-chalk-faint"
          >
            {preview ? 'Change image' : 'Upload image'}
          </button>
          {preview && (
            <button type="button" onClick={remove} className="flex min-h-9 items-center gap-1 text-[13px] text-chalk-muted hover:text-card-red">
              <RiDeleteBinLine className="h-4 w-4" /> Remove
            </button>
          )}
          <p className="text-[12px] text-chalk-faint">Square works best. JPEG, PNG or WebP.</p>
        </div>
        <input
          ref={input}
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
      {error && <p role="alert" className="mt-2 text-[13px] text-card-red">{error}</p>}
    </div>
  )
}
