import { afterEach, describe, expect, it, vi } from 'vitest'
import UTIF from 'utif2'
import { tiffToDataUrl } from '../src/tiff'

let maxCanvasDim = 0

function stubDom() {
  maxCanvasDim = 0
  const canvasStub = () => {
    let w = 0
    let h = 0
    return {
      get width() {
        return w
      },
      set width(v: number) {
        w = v
        maxCanvasDim = Math.max(maxCanvasDim, v)
      },
      get height() {
        return h
      },
      set height(v: number) {
        h = v
        maxCanvasDim = Math.max(maxCanvasDim, v)
      },
      getContext: () => ({
        putImageData: () => {},
      }),
      toDataURL: () => 'data:image/png;base64,AAAA',
    }
  }
  vi.stubGlobal('document', { createElement: canvasStub })
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: unknown,
        public w: number,
        public h: number,
      ) {}
    },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function giantIfd(width: number, height: number): Uint8Array {
  const buf = new ArrayBuffer(8 + 2 + 2 * 12 + 4)
  const view = new DataView(buf)
  view.setUint8(0, 0x49)
  view.setUint8(1, 0x49)
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)
  view.setUint16(8, 2, true)
  const entry = (i: number, tag: number, value: number) => {
    const off = 10 + i * 12
    view.setUint16(off, tag, true)
    view.setUint16(off + 2, 4, true)
    view.setUint32(off + 4, 1, true)
    view.setUint32(off + 8, value, true)
  }
  entry(0, 256, width)
  entry(1, 257, height)
  view.setUint32(10 + 2 * 12, 0, true)
  return new Uint8Array(buf)
}

describe('tiffToDataUrl dimension guard', () => {
  it('transcodes a small TIFF', () => {
    stubDom()
    const rgba = new Uint8Array(4 * 3 * 4).fill(128)
    const bytes = new Uint8Array(UTIF.encodeImage(rgba, 4, 3))
    expect(tiffToDataUrl(bytes)).toBe('data:image/png;base64,AAAA')
    expect(maxCanvasDim).toBe(4)
  })

  it('rejects giant IFD dims without allocating canvas pixels', () => {
    stubDom()
    const start = Date.now()
    expect(tiffToDataUrl(giantIfd(30000, 30000))).toBeNull()
    expect(Date.now() - start).toBeLessThan(10000)
    expect(maxCanvasDim).toBeLessThanOrEqual(8000)
  })
})
