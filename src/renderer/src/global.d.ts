import type { JarvisApi } from "@shared/types"

/* Material Web Components used in the UI. */
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-linear-progress": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        value?: number
        indeterminate?: boolean
        buffer?: number
      }
      "md-circular-progress": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        indeterminate?: boolean
        value?: number
      }
      "md-filled-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      "md-outlined-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      "md-text-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      "md-icon-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      "md-divider": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      "md-switch": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { selected?: boolean }
      "md-checkbox": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { selected?: boolean }
      "md-ripple": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}

declare global {
  interface Window {
    /** Bridge to the Electron main process, exposed by the preload script. */
    jarvis: JarvisApi
  }
}

export {}
