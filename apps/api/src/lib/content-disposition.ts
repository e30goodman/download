const INVALID_ASCII_FILENAME_CHARACTERS = /[^\x20-\x7e]|["\\\r\n]/g
const RFC_5987_EXTRA_CHARACTERS = /['()*]/g

const encodeRfc5987Value = (value: string): string =>
  encodeURIComponent(value).replace(
    RFC_5987_EXTRA_CHARACTERS,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )

export const createAttachmentContentDisposition = (fileName: string): string => {
  const asciiFallback =
    fileName.normalize('NFKD').replace(INVALID_ASCII_FILENAME_CHARACTERS, '_').trim() || 'download'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987Value(fileName)}`
}
