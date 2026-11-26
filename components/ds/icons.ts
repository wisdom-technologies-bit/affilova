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
// Every icon is imported by its own name from the barrel, so a bundler can drop
// the ~1500 icons that are not listed below. There is no `import * as`, and there
// is no dynamic lookup: `components/ds/icons.test.ts` fails the build on a
// wildcard import of Phosphor or a remaining lucide-react import anywhere in the
// source.
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
//   <CheckIcon />                        // 16px, bold, decorative
//   <StorefrontIcon size="lg" />         // 24px, regular
//   <WarningCircleIcon tone="danger" />  // 16px, fill: it carries a status
//   <CopyIcon label="Copy" />            // exposed to a screen reader as an image

import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  ArrowUpIcon,
  BankIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleNotchIcon,
  ClockIcon,
  CopyIcon,
  CursorClickIcon,
  DotIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  FacebookLogoIcon,
  GlobeIcon,
  HeartIcon,
  HourglassIcon,
  HouseIcon,
  InfoIcon,
  LightningIcon,
  LinkSimpleIcon,
  ListIcon,
  LockIcon,
  MagnifyingGlassIcon,
  MedalIcon,
  MegaphoneIcon,
  PackageIcon,
  PaperPlaneTiltIcon,
  PauseCircleIcon,
  PencilLineIcon,
  PlusIcon,
  ProhibitIcon,
  ProhibitInsetIcon,
  QrCodeIcon,
  SealCheckIcon,
  ShareNetworkIcon,
  ShieldIcon,
  ShieldWarningIcon,
  SignOutIcon,
  SidebarSimpleIcon,
  StorefrontIcon,
  TargetIcon,
  TrashIcon,
  TrendUpIcon,
  UsersIcon,
  WarningCircleIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr"
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
export const Archive = createIcon(ArchiveIcon)
export const ArrowCounterClockwise = createIcon(ArrowCounterClockwiseIcon)
export const ArrowDown = createIcon(ArrowDownIcon)
export const ArrowLeft = createIcon(ArrowLeftIcon)
export const ArrowRight = createIcon(ArrowRightIcon)
export const ArrowSquareOut = createIcon(ArrowSquareOutIcon)
export const ArrowUp = createIcon(ArrowUpIcon)
export const CaretDown = createIcon(CaretDownIcon)
export const CaretLeft = createIcon(CaretLeftIcon)
export const CaretRight = createIcon(CaretRightIcon)
export const CaretUp = createIcon(CaretUpIcon)
export const CaretUpDown = createIcon(CaretUpDownIcon)
export const DotsSixVertical = createIcon(DotsSixVerticalIcon)
export const DotsThree = createIcon(DotsThreeIcon)
export const House = createIcon(HouseIcon)
export const List = createIcon(ListIcon)
export const MagnifyingGlass = createIcon(MagnifyingGlassIcon)
export const SidebarSimple = createIcon(SidebarSimpleIcon)

// Actions.
export const Check = createIcon(CheckIcon)
export const Copy = createIcon(CopyIcon)
export const CursorClick = createIcon(CursorClickIcon)
export const Eye = createIcon(EyeIcon)
export const EyeSlash = createIcon(EyeSlashIcon)
export const LinkSimple = createIcon(LinkSimpleIcon)
export const PaperPlaneTilt = createIcon(PaperPlaneTiltIcon)
export const PencilLine = createIcon(PencilLineIcon)
export const Plus = createIcon(PlusIcon)
export const QrCode = createIcon(QrCodeIcon)
export const ShareNetwork = createIcon(ShareNetworkIcon)
export const SignOut = createIcon(SignOutIcon)
export const Trash = createIcon(TrashIcon)
export const X = createIcon(XIcon)

// Objects and places.
export const Bank = createIcon(BankIcon)
export const ChatCircle = createIcon(ChatCircleIcon)
export const EnvelopeSimple = createIcon(EnvelopeSimpleIcon)
export const FacebookLogo = createIcon(FacebookLogoIcon)
export const Globe = createIcon(GlobeIcon)
export const Heart = createIcon(HeartIcon)
export const Hourglass = createIcon(HourglassIcon)
export const Lock = createIcon(LockIcon)
export const Medal = createIcon(MedalIcon)
export const Megaphone = createIcon(MegaphoneIcon)
export const Package = createIcon(PackageIcon)
export const SealCheck = createIcon(SealCheckIcon)
export const Shield = createIcon(ShieldIcon)
export const ShieldWarning = createIcon(ShieldWarningIcon)
export const Storefront = createIcon(StorefrontIcon)
export const Target = createIcon(TargetIcon)
export const TrendUp = createIcon(TrendUpIcon)
export const Users = createIcon(UsersIcon)
export const Lightning = createIcon(LightningIcon)

// Status. These are the only icons that may be filled, and they are always
// drawn next to the word they stand for.
export const CheckCircle = createIcon(CheckCircleIcon)
export const Circle = createIcon(CircleIcon)
export const CircleDashed = createIcon(CircleDashedIcon)
export const Clock = createIcon(ClockIcon)
export const Dot = createIcon(DotIcon)
export const Info = createIcon(InfoIcon)
export const PauseCircle = createIcon(PauseCircleIcon)
export const Prohibit = createIcon(ProhibitIcon)
export const ProhibitInset = createIcon(ProhibitInsetIcon)
export const Warning = createIcon(WarningIcon)
export const WarningCircle = createIcon(WarningCircleIcon)

// The one icon that means "working": it spins, and the motion is removed under
// prefers-reduced-motion by the class the button gives it.
export const CircleNotch = createIcon(CircleNotchIcon)
