import { v2 as cloudinary } from "cloudinary"
import { Readable } from "stream"

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export interface UploadResult {
  public_id: string
  secure_url: string
  format: string
  resource_type: string
  bytes: number
}

export async function uploadToCloudinary(
  file: Buffer | string,
  options: {
    folder?: string
    resource_type?: "image" | "video" | "raw" | "auto"
    public_id?: string
    transformation?: any
  } = {},
): Promise<UploadResult> {
  try {
    let uploadStream: NodeJS.ReadableStream | Buffer | string

    if (Buffer.isBuffer(file)) {
      uploadStream = Readable.from(file)
    } else {
      uploadStream = file
    }

    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder || "affilova",
          resource_type: options.resource_type || "auto",
          public_id: options.public_id,
          transformation: options.transformation,
        },
        (error, result) => {
          if (error) reject(error)
          else resolve(result)
        },
      )

      if (Buffer.isBuffer(uploadStream)) {
        stream.end(uploadStream)
      } else if (uploadStream instanceof Readable) {
        uploadStream.pipe(stream)
      } else {
        reject(new Error("Invalid file type"))
      }
    })

    return {
      public_id: result.public_id,
      secure_url: result.secure_url,
      format: result.format,
      resource_type: result.resource_type,
      bytes: result.bytes,
    }
  } catch (error) {
    console.error("Cloudinary upload error:", error)
    throw new Error("Failed to upload file")
  }
}

export async function deleteFromCloudinary(publicId: string): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId)
  } catch (error) {
    console.error("Cloudinary delete error:", error)
    throw new Error("Failed to delete file")
  }
}

export function getCloudinaryUrl(
  publicId: string,
  options: {
    width?: number
    height?: number
    crop?: string
    quality?: string | number
    format?: string
  } = {},
): string {
  return cloudinary.url(publicId, {
    secure: true,
    ...options,
  })
}
