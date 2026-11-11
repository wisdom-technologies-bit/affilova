export type LogoVariant = "horizontal" | "stacked" | "icon"
export type LogoTone = "auto" | "light" | "dark"

type LogoAsset = {
  light: string
  dark: string
  width: number
  height: number
}

const LOGO_ASSETS: Record<LogoVariant, LogoAsset> = {
  horizontal: {
    light: "/brand/affilova-logo-horizontal.svg",
    dark: "/brand/affilova-logo-horizontal-reversed.svg",
    width: 795,
    height: 262,
  },
  stacked: {
    light: "/brand/affilova-logo-stacked.svg",
    dark: "/brand/affilova-logo-stacked-reversed.svg",
    width: 567,
    height: 492,
  },
  icon: {
    light: "/brand/affilova-icon.svg",
    dark: "/brand/affilova-icon.svg",
    width: 256,
    height: 256,
  },
}

export interface LogoProps {
  variant?: LogoVariant
  /**
   * "auto" follows the color scheme class on <html>. Use "light" on light
   * surfaces (dark wordmark) and "dark" on dark surfaces (reversed wordmark)
   * when the surface does not follow the color scheme.
   */
  tone?: LogoTone
  className?: string
}

function classes(...values: Array<string | undefined>): string {
  return values.filter((value) => value && value.length > 0).join(" ")
}

export function Logo({ variant = "horizontal", tone = "auto", className }: LogoProps) {
  const asset = LOGO_ASSETS[variant]

  if (tone !== "auto" || asset.light === asset.dark) {
    return (
      <img
        src={tone === "dark" ? asset.dark : asset.light}
        alt="Affilova"
        width={asset.width}
        height={asset.height}
        className={className}
      />
    )
  }

  // Both files are rendered and swapped with CSS so the correct logo is
  // painted on the first frame, with no flash before hydration.
  return (
    <>
      <img
        src={asset.light}
        alt="Affilova"
        width={asset.width}
        height={asset.height}
        className={classes(className, "dark:hidden")}
      />
      <img
        src={asset.dark}
        alt="Affilova"
        width={asset.width}
        height={asset.height}
        className={classes("hidden dark:inline-block", className)}
      />
    </>
  )
}
