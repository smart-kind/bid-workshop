/**
 * TIFF → PNG transcoding. Chromium cannot decode image/tiff, so pictures
 * embedded as word/media/*.tif(f) would render as blank frames. Decode with
 * UTIF (pure JS) and re-encode as PNG via canvas for display; the original
 * TIFF bytes stay untouched in the package so saving preserves them.
 */
import UTIF from 'utif2'

const TIFF_MIMES = new Set(['image/tiff', 'image/tif', 'image/x-tiff'])

export function isTiffMime(mime: string | undefined): mime is string {
  return mime !== undefined && TIFF_MIMES.has(mime)
}

// the engine compiles without DOM libs (it also runs under node); the canvas
// re-encode is reached only in renderer environments, typed structurally here
interface CanvasLike {
  width: number
  height: number
  getContext(id: '2d'): { putImageData(data: unknown, x: number, y: number): void } | null
  toDataURL(type: string): string
}
interface OffscreenCanvasLike {
  getContext(id: '2d'): { putImageData(data: unknown, x: number, y: number): void } | null
  convertToBlob(options: { type: string }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>
}
interface DomGlobals {
  document?: { createElement(tag: 'canvas'): CanvasLike }
  ImageData?: new (data: Uint8ClampedArray, w: number, h: number) => unknown
  OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvasLike
}

/** largest page of a TIFF as RGBA pixels, or null when UTIF cannot read it */
/** Pixel budget: a hostile word/media IFD with giant dims would allocate
 *  w*h*4 bytes on canvas. Fail closed (existing empty-frame degrade). */
const MAX_TIFF_PIXELS = 64 * 1024 * 1024
const MAX_TIFF_DIM = 8000

function tiffDimsOk(width: unknown, height: unknown): width is number {
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_TIFF_DIM &&
    height <= MAX_TIFF_DIM &&
    width * height <= MAX_TIFF_PIXELS
  )
}

function decodeTiff(
  bytes: ArrayBuffer | Uint8Array,
): { width: number; height: number; pixels: Uint8ClampedArray } | null {
  // copy into a fresh ArrayBuffer (a Uint8Array view may sit on a
  // SharedArrayBuffer, which UTIF's signature rejects)
  const buf = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes
  const ifds = UTIF.decode(buf)
  if (!ifds.length) return null
  // multi-page/multi-resolution TIFFs: pick the largest page within budget.
  // UTIF only fills .width/.height during decodeImage (which allocates the
  // pixels), so read the raw header tags (t256/t257) for the budget check
  // and decodeImage solely the chosen page.
  const headerDims = (ifd: Record<string, unknown>): { width: unknown; height: unknown } => ({
    width: Array.isArray(ifd.t256) ? ifd.t256[0] : (ifd as { width?: unknown }).width,
    height: Array.isArray(ifd.t257) ? ifd.t257[0] : (ifd as { height?: unknown }).height,
  })
  let page = ifds[0]
  let pageDims = headerDims(page)
  if (!tiffDimsOk(pageDims.width, pageDims.height)) return null
  for (const ifd of ifds) {
    const dims = headerDims(ifd)
    if (!tiffDimsOk(dims.width, dims.height)) continue
    if (
      (dims.width as number) * (dims.height as number) >
      (pageDims.width as number) * (pageDims.height as number)
    ) {
      page = ifd
      pageDims = dims
    }
  }
  UTIF.decodeImage(buf, page)
  const width = page.width as number
  const height = page.height as number
  if (!tiffDimsOk(width, height)) return null
  const rgba = UTIF.toRGBA8(page)
  return {
    width,
    height,
    pixels: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4),
  }
}

/**
 * Render TIFF bytes to a PNG data URL. Returns null on parse failure or when
 * no canvas API exists (non-renderer environments), so callers keep their
 * existing empty-frame degrade.
 */
export function tiffToDataUrl(bytes: ArrayBuffer | Uint8Array): string | null {
  const dom = globalThis as DomGlobals
  if (!dom.document || !dom.ImageData) return null
  try {
    const decoded = decodeTiff(bytes)
    if (!decoded) return null
    const { width, height, pixels } = decoded
    const canvas = dom.document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return null
    ctx2d.putImageData(new dom.ImageData(pixels, width, height), 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/**
 * The same re-encode where the parse runs off the document (a Worker): an
 * OffscreenCanvas produces the PNG. Falls back to the canvas path on the UI
 * thread, and to null without either API.
 */
export async function tiffToDataUrlAsync(bytes: ArrayBuffer | Uint8Array): Promise<string | null> {
  const dom = globalThis as DomGlobals
  if (dom.document) return tiffToDataUrl(bytes)
  if (!dom.OffscreenCanvas || !dom.ImageData) return null
  try {
    const decoded = decodeTiff(bytes)
    if (!decoded) return null
    const { width, height, pixels } = decoded
    const canvas = new dom.OffscreenCanvas(width, height)
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return null
    ctx2d.putImageData(new dom.ImageData(pixels, width, height), 0, 0)
    const png = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
    )
    let binary = ''
    for (let i = 0; i < png.length; i += 0x8000) {
      binary += String.fromCharCode(...png.subarray(i, i + 0x8000))
    }
    return `data:image/png;base64,${btoa(binary)}`
  } catch {
    return null
  }
}
