// The icon set, and the three rules that keep it quiet.
//
// Phosphor, imported by name. Phosphor ships two entries: `@phosphor-icons/react`
// is the client entry (its icons read an IconContext, which is a client-only API)
// and `@phosphor-icons/react/dist/ssr` is the same artwork as plain SVG with no
// context. This module imports from the SSR entry, so a server component can
// render an icon without a client boundary and a client component gets byte for
// byte the same markup. Nothing here uses IconContext: every prop is passed
// explicitly, which is what makes one module work on both sides.
//
// Every icon is imported from its own Phosphor module (`dist/ssr/House`), never
// from the package barrel, which re-exports about 1500 icons. There is no
// `import * as` and no lookup by string: components/ds/icons.test.ts fails the
// build on a wildcard import of Phosphor, on a barrel import of the icon package,
// and on a remaining lucide-react import anywhere in the source.
//
// What this module cannot do is keep the set out of one shared chunk. The icons
// are used across many routes, so the production build puts them in a chunk every
// page loads, and Phosphor carries six weights per icon. The measured cost is in
// docs/icons.md: about 36 KB compressed, once, for the whole set.
//
// The rules:
//
//  1. Three sizes, and only three: 16, 20 and 24. A size is a token (`sm`, `md`,
//     `lg`), never a class, so the same icon cannot be 14px on one screen and
//     18px on the next.
//  2. Weight follows size and meaning. Regular by default, bold at 16px so a
//     small icon still reads, and fill only for a status icon (success, warning,
//     danger, info), where the heavier shape is the second signal after the word
//     and before the colour.
//  3. An icon is never the only carrier of meaning. Decorative icons are
//     `aria-hidden` by default. A status icon always sits beside its word. An
//     icon-only button carries an `aria-label` on the button, not on the svg.
//
// The file is a `.ts`, not a `.tsx`: it is a module of re-exports and one small
// factory, so it holds no JSX and needs no JSX pragma. That is also what lets a
// server component import it without dragging a client component graph along.
//
// Usage:
//
//   <Check />                          // 16px, bold, decorative
//   <Storefront size="lg" />           // 24px, regular
//   <WarningCircle tone="danger" />    // 16px, fill: it carries a status
//   <Copy label="Copy" />              // exposed as an image with that name

import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise"
import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft"
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight"
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut"
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp"
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank"
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown"
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight"
import { CaretUpDownIcon } from "@phosphor-icons/react/dist/ssr/CaretUpDown"
import { CaretUpIcon } from "@phosphor-icons/react/dist/ssr/CaretUp"
import { ChatCircleIcon } from "@phosphor-icons/react/dist/ssr/ChatCircle"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle"
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check"
import { CircleDashedIcon } from "@phosphor-icons/react/dist/ssr/CircleDashed"
import { CircleIcon } from "@phosphor-icons/react/dist/ssr/Circle"
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr/CircleNotch"
import { ClockIcon } from "@phosphor-icons/react/dist/ssr/Clock"
import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy"
import { CursorClickIcon } from "@phosphor-icons/react/dist/ssr/CursorClick"
import { DotIcon } from "@phosphor-icons/react/dist/ssr/Dot"
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/ssr/DotsSixVertical"
import { DotsThreeIcon } from "@phosphor-icons/react/dist/ssr/DotsThree"
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple"
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye"
import { EyeSlashIcon } from "@phosphor-icons/react/dist/ssr/EyeSlash"
import { FacebookLogoIcon } from "@phosphor-icons/react/dist/ssr/FacebookLogo"
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe"
import { HeartIcon } from "@phosphor-icons/react/dist/ssr/Heart"
import { HourglassIcon } from "@phosphor-icons/react/dist/ssr/Hourglass"
import { HouseIcon } from "@phosphor-icons/react/dist/ssr/House"
import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info"
import { LightningIcon } from "@phosphor-icons/react/dist/ssr/Lightning"
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/ssr/LinkSimple"
import { ListIcon } from "@phosphor-icons/react/dist/ssr/List"
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass"
import { MedalIcon } from "@phosphor-icons/react/dist/ssr/Medal"
import { MegaphoneIcon } from "@phosphor-icons/react/dist/ssr/Megaphone"
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package"
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt"
import { PauseCircleIcon } from "@phosphor-icons/react/dist/ssr/PauseCircle"
import { PencilLineIcon } from "@phosphor-icons/react/dist/ssr/PencilLine"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { ProhibitIcon } from "@phosphor-icons/react/dist/ssr/Prohibit"
import { ProhibitInsetIcon } from "@phosphor-icons/react/dist/ssr/ProhibitInset"
import { QrCodeIcon } from "@phosphor-icons/react/dist/ssr/QrCode"
import { SealCheckIcon } from "@phosphor-icons/react/dist/ssr/SealCheck"
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/ssr/ShareNetwork"
import { ShieldIcon } from "@phosphor-icons/react/dist/ssr/Shield"
import { ShieldWarningIcon } from "@phosphor-icons/react/dist/ssr/ShieldWarning"
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/ssr/SidebarSimple"
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr/SignOut"
import { StorefrontIcon } from "@phosphor-icons/react/dist/ssr/Storefront"
import { TargetIcon } from "@phosphor-icons/react/dist/ssr/Target"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"
import { TrendUpIcon } from "@phosphor-icons/react/dist/ssr/TrendUp"
import { UsersIcon } from "@phosphor-icons/react/dist/ssr/Users"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning"
import { XIcon } from "@phosphor-icons/react/dist/ssr/X"
import type { Icon as PhosphorIcon, IconProps as PhosphorIconProps, IconWeight } from "@phosphor-icons/react"
import { createElement, type ComponentType } from "react"

/** The three sizes an icon may be drawn at, in px. */
export const ICON_SIZE = { sm: 16, md: 20, lg: 24 } as const

export type IconSize = keyof typeof ICON_SIZE

export interface IconProps
  extends Omit<PhosphorIconProps, "size" | "weight" | "alt" | "aria-hidden" | "role"> {
  /** A size token, not a class. Defaults to `sm` (16px). */
  size?: IconSize
  /** Overrides the weight the size and the tone would otherwise choose. */
  weight?: IconWeight
  /**
   * The icon carries meaning that is not in the surrounding text, so it is
   * exposed as an image with this name. Leave it out for a decorative icon.
   */
  label?: string
  /**
   * The status the icon stands for. Setting it draws the icon in `fill`, so the
   * meaning survives in greyscale, and it is the only way to get a filled icon.
   */
  tone?: "success" | "warning" | "danger" | "info"
}

/** What every icon in this module is: a component that takes an `IconProps`. */
export type IconComponent = ComponentType<IconProps>

function weightFor(size: IconSize, tone: IconProps["tone"]): IconWeight {
  if (tone !== undefined) {
    return "fill"
  }

  return size === "sm" ? "bold" : "regular"
}

function createIcon(Base: PhosphorIcon): IconComponent {
  function Icon({ size = "sm", weight, label, tone, ...rest }: IconProps) {
    const resolvedWeight = weight ?? weightFor(size, tone)

    return createElement(Base, {
      ...rest,
      size: ICON_SIZE[size],
      weight: resolvedWeight,
      alt: label,
      role: label === undefined ? undefined : "img",
      "aria-hidden": label === undefined ? true : undefined,
      focusable: "false",
    })
  }

  Icon.displayName = Base.displayName?.replace(/Icon$/, "") ?? "Icon"

  return Icon
}

// Navigation and structure.
export const Archive = /* @__PURE__ */ createIcon(ArchiveIcon)
export const ArrowCounterClockwise = /* @__PURE__ */ createIcon(ArrowCounterClockwiseIcon)
export const ArrowDown = /* @__PURE__ */ createIcon(ArrowDownIcon)
export const ArrowLeft = /* @__PURE__ */ createIcon(ArrowLeftIcon)
export const ArrowRight = /* @__PURE__ */ createIcon(ArrowRightIcon)
export const ArrowSquareOut = /* @__PURE__ */ createIcon(ArrowSquareOutIcon)
export const ArrowUp = /* @__PURE__ */ createIcon(ArrowUpIcon)
export const CaretDown = /* @__PURE__ */ createIcon(CaretDownIcon)
export const CaretLeft = /* @__PURE__ */ createIcon(CaretLeftIcon)
export const CaretRight = /* @__PURE__ */ createIcon(CaretRightIcon)
export const CaretUp = /* @__PURE__ */ createIcon(CaretUpIcon)
export const CaretUpDown = /* @__PURE__ */ createIcon(CaretUpDownIcon)
export const DotsSixVertical = /* @__PURE__ */ createIcon(DotsSixVerticalIcon)
export const DotsThree = /* @__PURE__ */ createIcon(DotsThreeIcon)
export const House = /* @__PURE__ */ createIcon(HouseIcon)
export const List = /* @__PURE__ */ createIcon(ListIcon)
export const MagnifyingGlass = /* @__PURE__ */ createIcon(MagnifyingGlassIcon)
export const SidebarSimple = /* @__PURE__ */ createIcon(SidebarSimpleIcon)

// Actions.
export const Check = /* @__PURE__ */ createIcon(CheckIcon)
export const Copy = /* @__PURE__ */ createIcon(CopyIcon)
export const CursorClick = /* @__PURE__ */ createIcon(CursorClickIcon)
export const Eye = /* @__PURE__ */ createIcon(EyeIcon)
export const EyeSlash = /* @__PURE__ */ createIcon(EyeSlashIcon)
export const LinkSimple = /* @__PURE__ */ createIcon(LinkSimpleIcon)
export const PaperPlaneTilt = /* @__PURE__ */ createIcon(PaperPlaneTiltIcon)
export const PencilLine = /* @__PURE__ */ createIcon(PencilLineIcon)
export const Plus = /* @__PURE__ */ createIcon(PlusIcon)
export const QrCode = /* @__PURE__ */ createIcon(QrCodeIcon)
export const ShareNetwork = /* @__PURE__ */ createIcon(ShareNetworkIcon)
export const SignOut = /* @__PURE__ */ createIcon(SignOutIcon)
export const Trash = /* @__PURE__ */ createIcon(TrashIcon)
export const X = /* @__PURE__ */ createIcon(XIcon)

// Objects and places.
export const Bank = /* @__PURE__ */ createIcon(BankIcon)
export const ChatCircle = /* @__PURE__ */ createIcon(ChatCircleIcon)
export const EnvelopeSimple = /* @__PURE__ */ createIcon(EnvelopeSimpleIcon)
export const FacebookLogo = /* @__PURE__ */ createIcon(FacebookLogoIcon)
export const Globe = /* @__PURE__ */ createIcon(GlobeIcon)
export const Heart = /* @__PURE__ */ createIcon(HeartIcon)
export const Hourglass = /* @__PURE__ */ createIcon(HourglassIcon)
export const Lock = /* @__PURE__ */ createIcon(LockIcon)
export const Medal = /* @__PURE__ */ createIcon(MedalIcon)
export const Megaphone = /* @__PURE__ */ createIcon(MegaphoneIcon)
export const Package = /* @__PURE__ */ createIcon(PackageIcon)
export const SealCheck = /* @__PURE__ */ createIcon(SealCheckIcon)
export const Shield = /* @__PURE__ */ createIcon(ShieldIcon)
export const ShieldWarning = /* @__PURE__ */ createIcon(ShieldWarningIcon)
export const Storefront = /* @__PURE__ */ createIcon(StorefrontIcon)
export const Target = /* @__PURE__ */ createIcon(TargetIcon)
export const TrendUp = /* @__PURE__ */ createIcon(TrendUpIcon)
export const Users = /* @__PURE__ */ createIcon(UsersIcon)
export const Lightning = /* @__PURE__ */ createIcon(LightningIcon)

// Status. These are the only icons that may be filled, and they are always
// drawn next to the word they stand for.
export const CheckCircle = /* @__PURE__ */ createIcon(CheckCircleIcon)
export const Circle = /* @__PURE__ */ createIcon(CircleIcon)
export const CircleDashed = /* @__PURE__ */ createIcon(CircleDashedIcon)
export const Clock = /* @__PURE__ */ createIcon(ClockIcon)
export const Dot = /* @__PURE__ */ createIcon(DotIcon)
export const Info = /* @__PURE__ */ createIcon(InfoIcon)
export const PauseCircle = /* @__PURE__ */ createIcon(PauseCircleIcon)
export const Prohibit = /* @__PURE__ */ createIcon(ProhibitIcon)
export const ProhibitInset = /* @__PURE__ */ createIcon(ProhibitInsetIcon)
export const Warning = /* @__PURE__ */ createIcon(WarningIcon)
export const WarningCircle = /* @__PURE__ */ createIcon(WarningCircleIcon)

// The one icon that means "working": it spins, and the motion is removed under
// prefers-reduced-motion by the class the button gives it.
export const CircleNotch = /* @__PURE__ */ createIcon(CircleNotchIcon)
