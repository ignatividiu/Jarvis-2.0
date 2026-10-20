import { marked } from "marked"
import DOMPurify from "dompurify"

/**
 * Markdown rendering.
 *
 * The output is sanitised before it reaches the DOM — a model can be talked
 * into emitting a script tag by whatever it read on the web.
 */
marked.setOptions({ gfm: true, breaks: true })

/** Strip the formatting, so the reply can be read aloud. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Render markdown into safe HTML. */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown ?? "", { async: false }) as string
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
