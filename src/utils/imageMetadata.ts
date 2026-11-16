import exifr from 'exifr'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'tiff' | 'heic' | 'avif' | 'bmp' | 'other'

export interface MetaEntry {
  label: string
  value: string
  /** Personal or device-identifying data worth highlighting (GPS, serials, owner). */
  sensitive?: boolean
}

export interface MetaSection {
  label: string
  entries: MetaEntry[]
}

export interface ImageMeta {
  kind: ImageKind
  sections: MetaSection[]
  total: number
  hasGps: boolean
  /** EXIF orientation 1-8, 1 = upright. */
  orientation: number
}

export type StripResult =
  | { status: 'stripped'; blob: Blob; removed: string[] }
  | { status: 'unsupported' }

const KIND_MIME: Record<ImageKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  heic: 'image/heic',
  avif: 'image/avif',
  bmp: 'image/bmp',
  other: 'application/octet-stream',
}

const KIND_LABEL: Record<ImageKind, string> = {
  jpeg: 'JPEG Image',
  png: 'PNG Image',
  webp: 'WebP Image',
  gif: 'GIF Image',
  tiff: 'TIFF Image',
  heic: 'HEIC Image',
  avif: 'AVIF Image',
  bmp: 'BMP Image',
  other: 'Image',
}

/** Formats that support lossless byte-level metadata removal. */
const LOSSLESS_KINDS: ImageKind[] = ['jpeg', 'png', 'webp', 'gif']

export const kindLabel = (kind: ImageKind) => KIND_LABEL[kind]
export const mimeForKind = (kind: ImageKind) => KIND_MIME[kind]
export const canStripLossless = (kind: ImageKind) => LOSSLESS_KINDS.includes(kind)

// ---------------------------------------------------------------------------
// Magic-byte format detection
// ---------------------------------------------------------------------------

const ascii = (buf: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...buf.subarray(start, start + length))

export function detectImageKind(buf: Uint8Array): ImageKind {
  if (buf.length < 12) return 'other'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return 'webp'
  if (ascii(buf, 0, 4) === 'GIF8') return 'gif'
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a) || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00)) return 'tiff'
  if (ascii(buf, 4, 4) === 'ftyp') {
    const brand = ascii(buf, 8, 4)
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs'].includes(brand)) return 'heic'
    if (['avif', 'avis'].includes(brand)) return 'avif'
    return 'other'
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp'
  return 'other'
}

// ---------------------------------------------------------------------------
// Metadata reading (via exifr)
// ---------------------------------------------------------------------------

/** Friendly display names for common tags. */
/** Friendly display names for common tags. */
const TAG_LABELS: Record<string, string> = {
  Author: 'Author',
  BitDepth: 'Bit Depth',
  ColorType: 'Color Type',
  latitude: 'Latitude', longitude: 'Longitude',
  Make: 'Camera Make', Model: 'Camera Model', LensMake: 'Lens Make', LensModel: 'Lens Model',
  BodySerialNumber: 'Camera Serial', SerialNumber: 'Camera Serial', InternalSerialNumber: 'Internal Serial',
  LensSerialNumber: 'Lens Serial', CameraOwnerName: 'Camera Owner', OwnerName: 'Owner', Software: 'Software',
  Firmware: 'Firmware', DateTime: 'Modified', DateTimeOriginal: 'Date Taken', CreateDate: 'Created',
  ModifyDate: 'Modified', GPSDateStamp: 'GPS Date', GPSAltitude: 'Altitude', GPSSpeed: 'Speed',
  GPSImgDirection: 'Image Direction', GPSDestBearing: 'Destination Bearing', GPSPosition: 'Position',
  ExposureTime: 'Exposure', FNumber: 'Aperture', ISOSpeedRatings: 'ISO', ISO: 'ISO',
  FocalLength: 'Focal Length', FocalLengthIn35mmFormat: 'Focal Length (35mm)', Flash: 'Flash',
  MeteringMode: 'Metering Mode', ExposureProgram: 'Exposure Program', WhiteBalance: 'White Balance',
  ColorSpace: 'Color Space', Orientation: 'Orientation', ImageWidth: 'Width', ImageHeight: 'Height',
  ExifImageWidth: 'Width', ExifImageHeight: 'Height', ResolutionUnit: 'Resolution Unit',
  XResolution: 'X Resolution', YResolution: 'Y Resolution', SubjectDistance: 'Subject Distance',
  DigitalZoomRatio: 'Digital Zoom', SceneCaptureType: 'Scene Type', Contrast: 'Contrast',
  Saturation: 'Saturation', Sharpness: 'Sharpness', ShutterSpeedValue: 'Shutter Speed',
  ApertureValue: 'Aperture', ExposureBiasValue: 'Exposure Bias', MaxApertureValue: 'Max Aperture',
  Artist: 'Artist', 'By-line': 'Author', Copyright: 'Copyright', Credit: 'Credit', Source: 'Source',
  Description: 'Description', ImageDescription: 'Description', UserComment: 'User Comment',
  Keywords: 'Keywords', Headline: 'Headline', 'Writer-Editor': 'Writer', ObjectName: 'Object Name',
  Title: 'Title', Subject: 'Subject', Comment: 'Comment', Rating: 'Rating', RatingPercent: 'Rating %',
  ProfileDescription: 'Profile Description', ColorSpace_2: 'Color Space', RenderingIntent: 'Rendering Intent',
  ProfileManufacturer: 'Profile Manufacturer', ProfileVersion: 'Profile Version',
}

/** Internal/duplicated tags hidden from the list (shown via friendlier keys instead). */
const HIDDEN_TAGS = new Set([
  'GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef',
  'GPSDestLatitude', 'GPSDestLatitudeRef', 'GPSDestLongitude', 'GPSDestLongitudeRef',
  'GPSVersionID', 'GPSMapDatum', 'GPSTrackRef', 'GPSImgDirectionRef', 'GPSDestBearingRef',
  'GPSSpeedRef', 'GPSAltitudeRef', 'GPSStatusRef', 'GPSDOP', 'GPSPDOP', 'GPSHDOP', 'GPSVDOP',
  'ExposureIndex', 'FileSource', 'SceneType', 'CFAPattern', 'SpatialFrequencyResponse',
  'SensingMethod', 'BatteryLevel', 'InteropIndex', 'InteropVersion', 'RelatedImageWidth',
  'RelatedImageHeight', 'RelatedSoundFile', 'SubSecTime', 'SubSecTimeOriginal', 'SubSecTimeDigitized',
  // Structural image properties (PNG IHDR / EXIF dimensions) — required pixel
  // data, not removable privacy metadata.
  'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight', 'PixelXDimension', 'PixelYDimension',
  'BitDepth', 'ColorType', 'Compression', 'Filter', 'Interlace',
])

const SENSITIVE_TAGS = new Set([
  'latitude', 'longitude', 'GPSAltitude', 'GPSSpeed', 'GPSImgDirection', 'GPSDestBearing', 'GPSDateStamp',
  'Make', 'Model', 'LensMake', 'BodySerialNumber', 'SerialNumber', 'InternalSerialNumber',
  'LensSerialNumber', 'CameraOwnerName', 'OwnerName', 'Software', 'Firmware',
  'Artist', 'By-line', 'Credit', 'Writer-Editor',
])

const GPS_KEYS = new Set(['latitude', 'longitude', 'GPSPosition', 'GPSDateStamp', 'GPSAltitude', 'GPSSpeed', 'GPSImgDirection', 'GPSDestBearing'])
const DEVICE_KEYS = new Set(['Make', 'Model', 'LensMake', 'LensModel', 'BodySerialNumber', 'SerialNumber', 'InternalSerialNumber', 'LensSerialNumber', 'CameraOwnerName', 'OwnerName', 'Software', 'Firmware'])
const CAPTURE_KEYS = new Set(['DateTime', 'DateTimeOriginal', 'CreateDate', 'ModifyDate', 'ExposureTime', 'FNumber', 'ISOSpeedRatings', 'ISO', 'FocalLength', 'FocalLengthIn35mmFormat', 'Flash', 'MeteringMode', 'ExposureProgram', 'WhiteBalance', 'ColorSpace', 'Orientation', 'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight', 'ResolutionUnit', 'XResolution', 'YResolution', 'SubjectDistance', 'DigitalZoomRatio', 'SceneCaptureType', 'Contrast', 'Saturation', 'Sharpness', 'ShutterSpeedValue', 'ApertureValue', 'ExposureBiasValue', 'MaxApertureValue', 'PixelXDimension', 'PixelYDimension'])
const CONTENT_KEYS = new Set(['Author', 'Artist', 'By-line', 'Copyright', 'Credit', 'Source', 'Description', 'ImageDescription', 'UserComment', 'Keywords', 'Headline', 'Writer-Editor', 'ObjectName', 'Title', 'Subject', 'Comment', 'Rating', 'RatingPercent'])
const ICC_SHOW = new Set(['ProfileDescription', 'ColorSpace', 'RenderingIntent', 'ProfileManufacturer', 'ProfileVersion'])

const fmtCoordinate = (value: number, pos: string, neg: string): string => {
  const dir = value >= 0 ? pos : neg
  const abs = Math.abs(value)
  const deg = Math.floor(abs)
  const minFull = (abs - deg) * 60
  const min = Math.floor(minFull)
  const sec = ((minFull - min) * 60).toFixed(2)
  return `${deg}° ${min}' ${sec}" ${dir}`
}

const fmtValue = (key: string, value: unknown): string => {
  if (value === null || value === undefined || value === '') return ''
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  }
  if (typeof value === 'string') {
    // Normalize EXIF date format "2026:05:12 14:33:21" -> "2026-05-12 14:33:21"
    const normalized = value.replace(/^(\d{4}):(\d{2}):(\d{2})(?= )/, '$1-$2-$3').trim()
    return normalized.length > 300 ? `${normalized.slice(0, 300)}…` : normalized
  }
  if (typeof value === 'number') {
    if (key === 'ExposureTime' || key === 'ShutterSpeedValue') return value > 0 && value < 1 ? `1/${Math.round(1 / value)} s` : `${value} s`
    if (key === 'FNumber' || key === 'ApertureValue' || key === 'MaxApertureValue') return `f/${value}`
    if (key === 'FocalLength' || key === 'FocalLengthIn35mmFormat') return `${value} mm`
    if (key === 'SubjectDistance') return `${value} m`
    if (Number.isInteger(value)) return String(value)
    return String(Math.round(value * 1e6) / 1e6)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(v => fmtValue(key, v)).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    // exifr GPS block hands back signed decimals under latitude/longitude.
    if (key === 'GPSPosition') {
      const pos = value as { latitude?: number, longitude?: number }
      if (typeof pos.latitude === 'number' && typeof pos.longitude === 'number') {
        return `${fmtCoordinate(pos.latitude, 'N', 'S')}, ${fmtCoordinate(pos.longitude, 'E', 'W')}`
      }
    }
    const json = JSON.stringify(value)
    return json.length > 300 ? `${json.slice(0, 300)}…` : json
  }
  return String(value)
}

const classifyKey = (key: string): string => {
  if (GPS_KEYS.has(key) || key.startsWith('GPS')) return 'GPS Location'
  if (DEVICE_KEYS.has(key)) return 'Camera & Device'
  if (CAPTURE_KEYS.has(key)) return 'Capture Settings'
  if (CONTENT_KEYS.has(key)) return 'Content & Authorship'
  return 'Other / Extended'
}

const SECTION_ORDER = ['GPS Location', 'Camera & Device', 'Capture Settings', 'Content & Authorship', 'Color Profile', 'GIF Blocks', 'Other / Extended']

// ---------------------------------------------------------------------------
// Native metadata readers for formats exifr doesn't cover (WebP, GIF)
// ---------------------------------------------------------------------------

/** Iterates RIFF chunks of a WebP file: [fourcc, payload, dataOffset][]. */
const readWebpChunks = (buf: Uint8Array): Array<{ id: string; data: Uint8Array }> => {
  const chunks: Array<{ id: string; data: Uint8Array }> = []
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = ascii(buf, pos, 4)
    const size = ((buf[pos + 4] | (buf[pos + 5] << 8) | (buf[pos + 6] << 16) | (buf[pos + 7] << 24)) >>> 0)
    const dataEnd = pos + 8 + size + (size % 2)
    if (dataEnd > buf.length) break
    chunks.push({ id, data: buf.subarray(pos + 8, pos + 8 + size) })
    pos = dataEnd
  }
  return chunks
}

/** Finds the TIFF header inside a WebP EXIF chunk (some encoders prepend "Exif\0\0"). */
const locateTiffPayload = (data: Uint8Array): Uint8Array | null => {
  const limit = Math.min(data.length - 4, 16)
  for (let i = 0; i <= limit; i++) {
    const isLE = data[i] === 0x49 && data[i + 1] === 0x49 && data[i + 2] === 0x2a && data[i + 3] === 0x00
    const isBE = data[i] === 0x4d && data[i + 1] === 0x4d && data[i + 2] === 0x00 && data[i + 3] === 0x2a
    if (isLE || isBE) return data.subarray(i)
  }
  return null
}

/** Concatenated sub-block payload of a GIF extension starting after the label byte. */
const gifSubBlockPayload = (buf: Uint8Array, start: number): { text: string; end: number } => {
  let p = start
  let text = ''
  while (p < buf.length && buf[p] !== 0) {
    const len = buf[p]
    text += ascii(buf, p + 1, len)
    p += 1 + len
  }
  return { text, end: Math.min(p + 1, buf.length) }
}

/** Reads GIF comment extensions and non-essential application blocks. */
const readGifBlocks = (buf: Uint8Array): { comments: string[]; appBlocks: string[] } => {
  const comments: string[] = []
  const appBlocks: string[] = []
  let pos = 6 + 7 // header + logical screen descriptor
  if (pos < buf.length && buf[10] & 0x80) pos += 3 * (2 << (buf[10] & 0x07)) // global color table

  while (pos < buf.length) {
    const block = buf[pos]
    if (block === 0x3b) break
    if (block === 0x21) {
      const label = buf[pos + 1]
      if (label === 0xfe) {
        const { text, end } = gifSubBlockPayload(buf, pos + 2)
        if (text) comments.push(text)
        pos = end
        continue
      }
      if (label === 0xff) {
        const appId = ascii(buf, pos + 3, 8)
        const { end } = gifSubBlockPayload(buf, pos + 14)
        if (appId !== 'NETSCAPE') appBlocks.push(appId.trim())
        pos = end
        continue
      }
      // other extensions (graphic control, plain text) — skip
      pos = gifSubBlockPayload(buf, pos + 2).end
      continue
    }
    if (block === 0x2c) { // image descriptor
      let p = pos + 10
      if (pos + 9 < buf.length && buf[pos + 9] & 0x80) p += 3 * (2 << (buf[pos + 9] & 0x07))
      p += 1 // LZW min code size
      pos = gifSubBlockPayload(buf, p).end
      continue
    }
    break // unknown block — stop
  }
  return { comments, appBlocks }
}

/**
 * Reads all viewable metadata from an image file (EXIF, GPS, XMP, IPTC, ICC).
 * Never throws — a file with no readable metadata returns empty sections.
 */
export async function readImageMetadata(file: File): Promise<ImageMeta> {
  const buffer = await file.arrayBuffer()
  const buf = new Uint8Array(buffer)
  const kind = detectImageKind(buf)
  const sections = new Map<string, MetaEntry[]>()

  const push = (section: string, entry: MetaEntry) => {
    if (!entry.value) return
    if (!sections.has(section)) sections.set(section, [])
    sections.get(section)!.push(entry)
  }

  let orientation = 1
  let hasGps = false

  // exifr covers JPEG/PNG/TIFF/HEIC/AVIF natively; WebP and GIF need custom
  // extraction (and WebP hands its EXIF chunk's TIFF payload to exifr).
  let exifInput: ArrayBuffer | Uint8Array = new Uint8Array(buffer)
  if (kind === 'webp') {
    const chunks = readWebpChunks(buf)
    const exifChunk = chunks.find(c => c.id === 'EXIF')
    const tiffPayload = exifChunk ? locateTiffPayload(exifChunk.data) : null
    exifInput = tiffPayload ?? new Uint8Array(0)
    const xmpChunk = chunks.find(c => c.id === 'XMP ')
    if (xmpChunk && xmpChunk.data.length > 0) {
      const xml = ascii(xmpChunk.data, 0, Math.min(xmpChunk.data.length, 400)).trim()
      push('Other / Extended', { label: 'XMP (raw)', value: xml.length >= 400 ? `${xml.slice(0, 399)}…` : xml, sensitive: true })
    }
    if (chunks.some(c => c.id === 'ICCP')) {
      push('Color Profile', { label: 'Profile', value: 'Embedded ICC profile' })
    }
  } else if (kind === 'gif') {
    exifInput = new Uint8Array(0)
    const { comments, appBlocks } = readGifBlocks(buf)
    if (comments.length) push('GIF Blocks', { label: 'Comment', value: comments.join(' | '), sensitive: true })
    for (const appId of appBlocks) push('GIF Blocks', { label: 'App Data', value: appId, sensitive: true })
  }

  try {
    const parsed: Record<string, any> | undefined = exifInput.length > 0
      ? await exifr.parse(exifInput, {
        tiff: true, exif: true, gps: true, xmp: true, iptc: true, translateValues: true, reviveValues: true,
      })
      : undefined

    // Numeric EXIF orientation (1-8), straight from the tag.
    const numeric = exifInput.length > 0 ? await exifr.orientation(exifInput).catch(() => undefined) : undefined
    if (typeof numeric === 'number' && numeric >= 1 && numeric <= 8) orientation = numeric

    if (parsed) {
      for (const [key, raw] of Object.entries(parsed)) {
        if (HIDDEN_TAGS.has(key)) continue
        const label = TAG_LABELS[key] || key
        let value: string
        if ((key === 'latitude' || key === 'longitude') && typeof raw === 'number') {
          value = fmtCoordinate(raw, key === 'latitude' ? 'N' : 'E', key === 'latitude' ? 'S' : 'W')
        } else {
          value = fmtValue(key, raw)
        }
        if (GPS_KEYS.has(key)) hasGps = true
        push(classifyKey(key), { label, value, sensitive: SENSITIVE_TAGS.has(key) })
      }
    }
  } catch {
    // No readable metadata in this format — sections stay empty.
  }

  try {
    const icc: Record<string, any> | undefined = await exifr.parse(buffer, {
      tiff: false, xmp: false, iptc: false, icc: true,
    })
    if (icc) {
      for (const [key, raw] of Object.entries(icc)) {
        if (!ICC_SHOW.has(key)) continue
        push('Color Profile', { label: TAG_LABELS[key] || key, value: fmtValue(key, raw) })
      }
    }
  } catch {
    // ICC block not present or unreadable — skip.
  }

  const ordered = SECTION_ORDER
    .filter(label => sections.has(label) && sections.get(label)!.length > 0)
    .map(label => ({ label, entries: sections.get(label)! }))

  return {
    kind,
    sections: ordered,
    total: ordered.reduce((sum, s) => sum + s.entries.length, 0),
    hasGps,
    orientation,
  }
}

// ---------------------------------------------------------------------------
// Lossless byte-level metadata stripping
// ---------------------------------------------------------------------------

const stripJpeg = (buf: Uint8Array): { blob: Blob; removed: string[] } => {
  const out: Uint8Array[] = [buf.subarray(0, 2)] // SOI
  const removed = new Set<string>()

  const noteApp = (marker: number, data: Uint8Array) => {
    const head = ascii(data, 4, Math.min(20, data.length - 4))
    if (marker === 0xe1) {
      if (head.startsWith('Exif')) removed.add('EXIF')
      else if (head.startsWith('http://ns.adobe.com/xap/')) removed.add('XMP')
      else removed.add('APP1 segment')
    } else if (marker === 0xe2) removed.add('ICC color profile')
    else if (marker === 0xed) removed.add('Photoshop/IPTC data')
    else removed.add(`APP${marker - 0xe0} segment`)
  }

  let pos = 2
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) {
      // Not at a marker — unexpected bytes; keep the remainder verbatim.
      out.push(buf.subarray(pos))
      break
    }
    let m = pos
    while (m < buf.length && buf[m] === 0xff) m++
    if (m >= buf.length) break
    const marker = buf[m]

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xd9) {
      out.push(buf.subarray(pos, m + 1)) // standalone marker, keep verbatim
      pos = m + 1
      continue
    }
    if (m + 3 > buf.length) { out.push(buf.subarray(pos)); break }
    const segEnd = m + 1 + (((buf[m + 1] << 8) | buf[m + 2])) // marker + 2-byte length + payload
    if (segEnd > buf.length) { out.push(buf.subarray(pos)); break } // bogus length — keep tail verbatim

    if (marker === 0xda) { // SOS — entropy-coded scan follows; keep everything verbatim
      out.push(buf.subarray(pos))
      break
    }
    if (marker >= 0xe1 && marker <= 0xef) {
      noteApp(marker, buf.subarray(m, segEnd))
      pos = segEnd
      continue
    }
    if (marker === 0xfe) { // JPEG comment
      removed.add('JPEG comment')
      pos = segEnd
      continue
    }
    out.push(buf.subarray(pos, segEnd))
    pos = segEnd
  }

  return { blob: new Blob(out as BlobPart[], { type: 'image/jpeg' }), removed: [...removed] }
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'])

const stripPng = (buf: Uint8Array): { blob: Blob; removed: string[] } => {
  const out: Uint8Array[] = [buf.subarray(0, 8)] // PNG signature
  const removed = new Set<string>()
  let pos = 8

  while (pos + 8 <= buf.length) {
    const len = ((buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]) >>> 0
    const type = ascii(buf, pos + 4, 4)
    const chunkEnd = pos + 12 + len // length + type + data + CRC
    if (chunkEnd > buf.length) { out.push(buf.subarray(pos)); break } // malformed tail — keep verbatim
    if (PNG_DROP.has(type)) {
      if (type === 'eXIf') removed.add('EXIF chunk')
      else if (type === 'tIME') removed.add('Timestamp chunk')
      else removed.add('Text chunk')
    } else {
      out.push(buf.subarray(pos, chunkEnd))
    }
    if (type === 'IEND') break
    pos = chunkEnd
  }

  return { blob: new Blob(out as BlobPart[], { type: 'image/png' }), removed: [...removed] }
}

const stripWebp = (buf: Uint8Array): { blob: Blob; removed: string[] } => {
  const removed = new Set<string>()
  const kept: Uint8Array[] = []
  let hasVp8x = false
  let pos = 12

  while (pos + 8 <= buf.length) {
    const fourcc = ascii(buf, pos, 4)
    const size = (buf[pos + 4] | (buf[pos + 5] << 8) | (buf[pos + 6] << 16) | (buf[pos + 7] << 24)) >>> 0
    const dataEnd = pos + 8 + size + (size % 2) // odd-sized chunks carry one pad byte
    if (dataEnd > buf.length) { kept.push(buf.subarray(pos)); break } // malformed tail

    if (fourcc === 'VP8X') {
      hasVp8x = true
      const chunk = buf.subarray(pos, pos + 8 + size)
      kept.push(chunk)
    } else if (fourcc === 'EXIF' || fourcc === 'XMP ' || fourcc === 'ICCP') {
      removed.add(fourcc === 'EXIF' ? 'EXIF' : fourcc === 'XMP ' ? 'XMP' : 'ICC color profile')
    } else {
      kept.push(buf.subarray(pos, dataEnd))
    }
    pos = dataEnd
  }

  if (hasVp8x) {
    // Clear the ICC/EXIF/XMP presence flag bits in the VP8X chunk (byte 0 of its payload).
    const flags = 0x20 | 0x08 | 0x04
    for (const chunk of kept) {
      if (ascii(chunk, 0, 4) === 'VP8X') {
        chunk[8] = (chunk[8] & ~flags) as number
        break
      }
    }
  }

  const bodySize = kept.reduce((sum, c) => sum + c.length, 4) // + 'WEBP'
  const header = new Uint8Array(12)
  header.set([0x52, 0x49, 0x46, 0x46]) // RIFF
  header[4] = bodySize & 0xff; header[5] = (bodySize >>> 8) & 0xff; header[6] = (bodySize >>> 16) & 0xff; header[7] = (bodySize >>> 24) & 0xff
  header.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP

  return { blob: new Blob([header, ...kept] as BlobPart[], { type: 'image/webp' }), removed: [...removed] }
}

const stripGif = (buf: Uint8Array): { blob: Blob; removed: string[] } => {
  const removed = new Set<string>()
  let pos = 6 + 7 // header + logical screen descriptor
  if (pos < buf.length && buf[10] & 0x80) {
    pos += 3 * (2 << (buf[10] & 0x07)) // global color table
  }
  const out: Uint8Array[] = [buf.subarray(0, pos)] // signature + LSD (+ GCT) kept verbatim

  const subBlocksEnd = (p: number): number => {
    while (p < buf.length && buf[p] !== 0) p += 1 + buf[p]
    return Math.min(p + 1, buf.length)
  }

  while (pos < buf.length) {
    const block = buf[pos]
    if (block === 0x3b) { // trailer
      out.push(buf.subarray(pos))
      break
    }
    if (block === 0x21) { // extension
      const label = buf[pos + 1]
      // App extensions carry a size byte + 11-byte id/auth header; plain text a
      // size byte + 12-byte grid header — both before the actual sub-blocks.
      const scan = label === 0xff ? pos + 14 : label === 0x01 ? pos + 15 : pos + 2
      const end = subBlocksEnd(scan)
      if (label === 0xfe) {
        removed.add('Comment block')
      } else if (label === 0xff) {
        const appId = ascii(buf, pos + 3, 8)
        if (appId !== 'NETSCAPE') removed.add(`App data (${appId.trim()})`)
        else out.push(buf.subarray(pos, end)) // loop control — keep animation looping
      } else {
        out.push(buf.subarray(pos, end))
      }
      pos = end
      continue
    }
    if (block === 0x2c) { // image descriptor — copy fully (optional LCT + LZW sub-blocks)
      let p = pos + 10
      if (pos + 9 < buf.length && buf[pos + 9] & 0x80) p += 3 * (2 << (buf[pos + 9] & 0x07))
      p += 1 // LZW minimum code size
      const end = subBlocksEnd(p)
      out.push(buf.subarray(pos, end))
      pos = end
      continue
    }
    // Unknown block — keep the remainder verbatim to stay safe.
    out.push(buf.subarray(pos))
    break
  }

  return { blob: new Blob(out as BlobPart[], { type: 'image/gif' }), removed: [...removed] }
}

/**
 * Removes metadata from an image without re-encoding pixels for JPEG, PNG,
 * WebP and GIF. Any other format reports `unsupported` so the caller can fall
 * back to a canvas re-encode.
 */
export async function stripImageMetadata(file: File): Promise<StripResult> {
  const buffer = await file.arrayBuffer()
  const buf = new Uint8Array(buffer)
  const kind = detectImageKind(buf)

  switch (kind) {
    case 'jpeg': {
      const { blob, removed } = stripJpeg(buf)
      return { status: 'stripped', blob, removed }
    }
    case 'png': {
      const { blob, removed } = stripPng(buf)
      return { status: 'stripped', blob, removed }
    }
    case 'webp': {
      const { blob, removed } = stripWebp(buf)
      return { status: 'stripped', blob, removed }
    }
    case 'gif': {
      const { blob, removed } = stripGif(buf)
      return { status: 'stripped', blob, removed }
    }
    default:
      return { status: 'unsupported' }
  }
}

// ---------------------------------------------------------------------------
// Canvas re-encode fallback (strips everything, recompresses pixels)
// ---------------------------------------------------------------------------

/**
 * Re-encodes an image through a canvas, which drops all metadata. EXIF
 * orientation is baked into the pixels so the output displays upright.
 * Returns null when the browser cannot decode the format (e.g. HEIC).
 */
export async function reencodeImage(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)

    const encodable = ['image/png', 'image/jpeg', 'image/webp', 'image/avif']
    const target = encodable.includes(file.type) ? file.type : 'image/png'
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, target))
    // Some browsers silently fall back to PNG when the requested type is unsupported.
    return blob ?? null
  } catch {
    return null
  } finally {
    bitmap.close()
  }
}

/** Picks the right file extension from a processed blob, preferring the source format. */
export const extFromBlob = (blob: Blob, sourceFile: File): string => {
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'image/tiff': 'tiff', 'image/heic': 'heic', 'image/avif': 'avif', 'image/bmp': 'bmp',
  }
  if (byMime[blob.type]) return byMime[blob.type]
  const srcExt = sourceFile.name.toLowerCase().split('.').pop() || ''
  return srcExt || 'jpg'
}
