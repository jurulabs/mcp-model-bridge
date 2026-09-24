const BYTE_ORDER_MARK = '\uFEFF';

/**
 * Removes a leading UTF-8 byte order mark.
 *
 * Windows editors and PowerShell write one by default. Without this, a policy
 * file saved in Notepad fails `JSON.parse`, and an agent file saved the same
 * way fails frontmatter detection, both with errors that point nowhere near
 * the real cause.
 */
export function stripBom(content: string): string {
  return content.startsWith(BYTE_ORDER_MARK) ? content.slice(BYTE_ORDER_MARK.length) : content;
}

