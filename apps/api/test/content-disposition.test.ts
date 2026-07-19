import { describe, expect, it } from 'vitest'
import { createAttachmentContentDisposition } from '../src/lib/content-disposition'

describe('attachment content disposition', () => {
  it('keeps headers ASCII-safe while preserving a UTF-8 filename', () => {
    const header = createAttachmentContentDisposition(
      'Midnight Express — аранжировка для бас-гитары.mp4'
    )

    expect(header).toContain('filename="Midnight Express')
    expect(header).toContain("filename*=UTF-8''Midnight%20Express")
    expect(header).toContain('%D0%B0%D1%80%D0%B0%D0%BD%D0%B6%D0%B8%D1%80%D0%BE%D0%B2%D0%BA%D0%B0')
    expect([...header].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(true)
  })

  it('removes header control characters from the fallback filename', () => {
    const header = createAttachmentContentDisposition('bad"\r\nname.mp4')

    expect(header).toContain('filename="bad___name.mp4"')
    expect(header).not.toContain('\r')
    expect(header).not.toContain('\n')
  })
})
