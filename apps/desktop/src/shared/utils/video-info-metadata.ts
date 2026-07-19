import type { AppSettings, DownloadOptions, VideoFormat, VideoInfo } from '../types'

type VideoInfoDownloadMetadata = Pick<
  DownloadOptions,
  'title' | 'thumbnail' | 'description' | 'channel' | 'uploader' | 'viewCount' | 'duration'
>

const qualityPresetToVideoHeight: Record<AppSettings['oneClickQuality'], number | null> = {
  best: null,
  good: 1080,
  normal: 720,
  bad: 480,
  worst: 360
}

const qualityPresetToAudioBitrate: Record<AppSettings['oneClickQuality'], number | null> = {
  best: 320,
  good: 256,
  normal: 192,
  bad: 128,
  worst: 96
}

const getFormatSize = (format: VideoFormat): number =>
  format.filesize ?? format.filesize_approx ?? 0

const isVideoFormat = (format: VideoFormat): boolean =>
  Boolean(format.vcodec && format.vcodec !== 'none')

const isAudioOnlyFormat = (format: VideoFormat): boolean =>
  Boolean(
    format.acodec &&
      format.acodec !== 'none' &&
      (format.video_ext === 'none' ||
        !format.video_ext ||
        !format.vcodec ||
        format.vcodec === 'none')
  )

const sortVideoFormatsByQuality = (a: VideoFormat, b: VideoFormat): number => {
  const heightDiff = (b.height ?? 0) - (a.height ?? 0)
  if (heightDiff !== 0) {
    return heightDiff
  }
  const fpsDiff = (b.fps ?? 0) - (a.fps ?? 0)
  if (fpsDiff !== 0) {
    return fpsDiff
  }
  const aHasSize = Boolean(a.filesize || a.filesize_approx)
  const bHasSize = Boolean(b.filesize || b.filesize_approx)
  if (aHasSize !== bHasSize) {
    return bHasSize ? 1 : -1
  }
  return getFormatSize(b) - getFormatSize(a)
}

const sortAudioFormatsByQuality = (a: VideoFormat, b: VideoFormat): number => {
  const bitrateDiff = (b.tbr ?? 0) - (a.tbr ?? 0)
  if (bitrateDiff !== 0) {
    return bitrateDiff
  }
  return getFormatSize(b) - getFormatSize(a)
}

/** Builds the metadata fields that should survive a download task projection. */
export const buildVideoInfoDownloadMetadata = (
  videoInfo: VideoInfo | null | undefined
): VideoInfoDownloadMetadata => {
  if (!videoInfo) {
    return {}
  }

  return {
    title: videoInfo.title,
    thumbnail: videoInfo.thumbnail,
    description: videoInfo.description,
    channel: videoInfo.extractor_key,
    uploader: videoInfo.uploader ?? videoInfo.extractor_key,
    viewCount: videoInfo.view_count,
    duration: videoInfo.duration
  }
}

/** Picks a display format that mirrors the one-click quality preset. */
export const pickOneClickSelectedFormat = (
  videoInfo: VideoInfo | null | undefined,
  settings: Pick<AppSettings, 'oneClickDownloadType' | 'oneClickQuality'>
): VideoFormat | undefined => {
  const formats = videoInfo?.formats ?? []

  if (settings.oneClickDownloadType === 'audio') {
    const sortedAudioFormats = formats.filter(isAudioOnlyFormat).sort(sortAudioFormatsByQuality)
    if (sortedAudioFormats.length === 0) {
      return undefined
    }
    if (settings.oneClickQuality === 'worst') {
      return sortedAudioFormats.at(-1) ?? sortedAudioFormats[0]
    }
    const bitrateLimit = qualityPresetToAudioBitrate[settings.oneClickQuality]
    const matchingBitrate = sortedAudioFormats.find((format) => {
      if (!(bitrateLimit && format.tbr)) {
        return false
      }
      return format.tbr <= bitrateLimit
    })
    return matchingBitrate ?? sortedAudioFormats[0]
  }

  if (settings.oneClickDownloadType === 'text') {
    return undefined
  }

  const sortedVideoFormats = formats.filter(isVideoFormat).sort(sortVideoFormatsByQuality)
  if (sortedVideoFormats.length === 0) {
    return undefined
  }
  if (settings.oneClickQuality === 'worst') {
    return sortedVideoFormats.at(-1) ?? sortedVideoFormats[0]
  }

  const heightLimit = qualityPresetToVideoHeight[settings.oneClickQuality]
  if (!heightLimit) {
    return sortedVideoFormats[0]
  }

  const matchingHeight = sortedVideoFormats.find((format) => {
    if (!format.height) {
      return false
    }
    return format.height <= heightLimit
  })
  return matchingHeight ?? sortedVideoFormats[0]
}
