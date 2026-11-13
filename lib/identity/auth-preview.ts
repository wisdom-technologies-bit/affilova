// The product screenshot that can sit under the panel copy in the desktop auth
// layout. It is intentionally empty for now: while this is null the panel
// renders no image at all and reserves no space for one, so the layout is
// unchanged. Adding a real screenshot later is a one line change here, with no
// component edits.

export type AuthPreviewImage = {
  src: string
  alt: string
  width: number
  height: number
}

export const AUTH_PREVIEW_IMAGE: AuthPreviewImage | null = null
