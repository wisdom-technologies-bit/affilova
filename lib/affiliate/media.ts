// Cloudinary delivery for the marketplace thumbnails.
//
// The public id is a value a vendor's upload produced, so it is checked before
// it becomes part of a URL: a value carrying its own transformation, a query or
// a scheme is refused rather than pasted in. The transformation is fixed here
// (fill crop, 400x300, automatic format and quality), so the grid always gets
// the same shape.

const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/

/**
 * A 400x300 fill-cropped thumbnail URL, or null when the id or the cloud name
 * cannot be trusted.
 */
export function productCoverUrl(publicId: string | null, cloudName: string | null): string | null {
  if (publicId === null || cloudName === null) {
    return null
  }

  if (publicId === "" || cloudName === "" || !PUBLIC_ID.test(publicId)) {
    return null
  }

  return `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,w_400,h_300,f_auto,q_auto/${publicId}`
}
