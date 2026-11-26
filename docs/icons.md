# Icons

Affilova draws every icon with [Phosphor](https://phosphoricons.com) (MIT,
`@phosphor-icons/react`). lucide-react is gone: `components/ds/icons.test.ts`
fails the build if any file imports it again.

## Why Phosphor, and how it is imported

Phosphor ships two entries:

- `@phosphor-icons/react` is the **client** entry. Its icons read an
  `IconContext`, which is a client-only API, so importing it into a server
  component is an error.
- `@phosphor-icons/react/dist/ssr` is the **server** entry. Same artwork, plain
  SVG, no context.

`components/ds/icons.ts` imports from the **SSR entry** and re-exports the
approved set. One module therefore works in a server component (no client
boundary is created) and in a client component (the icon is compiled into the
client bundle and renders identical markup). The product never uses
`IconContext`, so nothing is lost: every prop is passed explicitly.

Each icon is imported by its own name from the barrel. There is no
`import * as Phosphor`, and no dynamic lookup by string, so a bundler drops the
~1500 icons that are not listed. `components/ds/icons.test.ts` fails on a
wildcard import of Phosphor, on a lucide-react import, and on an icon-only
button with no accessible name.

## Sizes and weights

Three sizes, and only three. A size is a token, never a class:

| Token | px | Weight |
| --- | --- | --- |
| `sm` | 16 | bold |
| `md` | 20 | regular |
| `lg` | 24 | regular |

Bold at 16px keeps a small icon legible at the weight the rest of the interface
uses for small type. `fill` is reserved for a **status** icon (success, warning,
danger, info), where the solid shape is the signal that survives greyscale,
screenshots and colour blindness. A status icon is always drawn beside its word.

```tsx
<Check />                          // 16px, bold, decorative
<Storefront size="lg" />           // 24px, regular
<WarningCircle tone="danger" />    // 16px, fill: carries a status
<Copy label="Copy" />              // exposed as an image with that name
```

## Accessibility rules

1. **Decorative by default.** An icon is `aria-hidden` and `focusable="false"`
   unless it is given a `label`, which renders a `<title>` and `role="img"`.
2. **An icon is never the only carrier of meaning.** A status is an icon and a
   word. A button that shows only an icon carries an `aria-label` on the
   **button**, not on the svg.
3. **A spinner is not a status.** `Spinner` keeps `role="status"` and
   `aria-label="Loading"`; motion is removed under `prefers-reduced-motion` by
   `app/globals.css`.

## The mapping

Every file that imported lucide-react now imports from `@/components/ds/icons`.
The Phosphor name in the third column is the export name used in this codebase
(the Phosphor package also accepts the same name with an `Icon` suffix; both are
the same component).

| lucide-react | Phosphor | Visual difference |
| --- | --- | --- |
| `AlertTriangle` | `Warning` | Phosphor draws a rounded triangle with an exclamation mark. Same meaning, softer corners. |
| `Archive` | `Archive` | Phosphor's lid and box are drawn with slightly heavier strokes. |
| `ArrowDown` | `ArrowDown` | Same arrow, Phosphor's head is wider. |
| `ArrowLeft` | `ArrowLeft` | Same. |
| `ArrowRight` | `ArrowRight` | Same. |
| `ArrowUp` | `ArrowUp` | Same arrow, Phosphor's head is wider. |
| `Award` | `Medal` | Phosphor has no ribbon award; `Medal` is a disc on a ribbon. Same "recognition" meaning. |
| `Ban` | `Prohibit` | Phosphor's circle-with-slash. Same meaning. |
| `Check` | `Check` | Same tick, Phosphor's is slightly thicker at the same weight. |
| `CheckCircle` | `CheckCircle` | Same. |
| `ChevronDown` | `CaretDown` | **Phosphor names these `Caret*`.** The chevron is a filled triangle rather than a stroked V. |
| `ChevronLeft` | `CaretLeft` | As above. |
| `ChevronRight` | `CaretRight` | As above. |
| `ChevronUp` | `CaretUp` | As above. |
| `ChevronsUpDown` | `CaretUpDown` | Two stacked carets instead of two chevrons. |
| `Circle` | `Circle` | Same. Used filled inside a radio and a menu item. |
| `CircleAlert` | `WarningCircle` | Same circle-and-exclamation, Phosphor's mark is taller. |
| `CircleCheck` | `CheckCircle` | Same glyph, different name. |
| `CircleDashed` | `CircleDashed` | Same dashed ring. |
| `CirclePause` | `PauseCircle` | Same. |
| `CircleSlash` | `ProhibitInset` | Phosphor's slash sits inside a ring. Used for "declined" and "stopped". |
| `Clock3` | `Clock` | Phosphor has one clock; the hands point to 12 rather than 3. No meaning is lost: the word is always beside it. |
| `Copy` | `Copy` | Two rounded sheets, Phosphor's are slightly smaller at the same size. |
| `Dot` | `Dot` | Same filled dot. |
| `ExternalLink` | `ArrowSquareOut` | Phosphor's arrow leaves a square. Same meaning. |
| `Eye` | `Eye` | Same. |
| `EyeOff` | `EyeSlash` | Same eye with a slash; Phosphor's slash is thinner. |
| `Facebook` | `FacebookLogo` | The brand mark, same. |
| `Globe` | `Globe` | Same. |
| `GripVertical` | `DotsSixVertical` | Six dots instead of a dot grid with lines. Same drag affordance. |
| `Heart` | `Heart` | Same. |
| `Home` | `House` | Same roof-and-door glyph under a different name. |
| `Hourglass` | `Hourglass` | Same. |
| `Info` | `Info` | Same. |
| `Landmark` | `Bank` | Phosphor's bank is a pediment on columns; lucide's is the same building with a different roofline. |
| `Link2` | `LinkSimple` | One chain link rather than two overlapping. Same meaning. |
| `Loader2` | `CircleNotch` | The spinner: a ring with a gap. Spin comes from `animate-spin`, not the icon. |
| `LogOut` | `SignOut` | Phosphor's arrow leaves a bracket. Same meaning. |
| `Menu` | `List` | Three lines instead of three lines in a box. |
| `MessageCircle` | `ChatCircle` | Same speech bubble. |
| `MoreHorizontal` | `DotsThree` | Same. |
| `MousePointerClick` | `CursorClick` | Same pointer with a click burst. |
| `PackageSearch` | `Package` | **Phosphor has no package-with-magnifier.** The empty state pairs `Package` with the words, so the search meaning lives in the copy, not the glyph. |
| `PanelLeft` | `SidebarSimple` | Phosphor's sidebar icon is a panel with one divider. |
| `PencilLine` | `PencilLine` | Same. |
| `Plus` | `Plus` | Same. |
| `QrCode` | `QrCode` | Same. |
| `RotateCcw` | `ArrowCounterClockwise` | Same arrow around a point. |
| `Search` | `MagnifyingGlass` | Same. |
| `Send` | `PaperPlaneTilt` | A paper plane instead of a triangular send arrow. Same meaning in the share menu. |
| `Share2` | `ShareNetwork` | Three connected nodes instead of three dots on lines. |
| `Shield` | `Shield` | Same. |
| `ShieldAlert` | `ShieldWarning` | Same. |
| `Target` | `Target` | Same concentric rings. |
| `Trash2` | `Trash` | Phosphor's bin has no separate lid line. |
| `TrendingUp` | `TrendUp` | Same rising line with an arrow. |
| `TriangleAlert` | `Warning` | Same as `AlertTriangle`. |
| `Users` | `Users` | Two figures, Phosphor's are rounder. |
| `X` | `X` | Same. |
| `Zap` | `Lightning` | A bolt, Phosphor's is wider. |
| `type LucideIcon` | `type IconComponent` | The type every icon in the set satisfies. |

### Icons added for the front door

These had no lucide equivalent in the codebase and are new to the approved set:

| Phosphor | Used for |
| --- | --- |
| `Bank` | "Payouts go to your bank account" on the auth panel. |
| `EnvelopeSimple` | The "check your email" panel. |
| `Lock` | The reset-password panel. |
| `SealCheck` | "Files are security scanned" on the auth panel. |
| `Shield` | The same list, when a shield reads better than a seal. |
| `Storefront` | The vendor role card. |
| `Megaphone` | The affiliate role card. |
| `CaretUpDown` | A sortable table header. |

## Sizes in the shadcn primitives

`components/ui/*` keeps the icon sizes shadcn generated with (`size-4`,
`h-3.5`, `h-2` for a menu dot). Those are inside a generated primitive whose
geometry the design system does not own, and resizing them would change every
screen that uses a `Select`, a `DropdownMenu` or a `Calendar`. Every component
in `components/ds/*` and every page touched by the front-door pass uses the
three tokens instead. A primitive that needs a different size gets it from a
class on the primitive, not from a fourth token.

## What the migration cost

First-load JavaScript, measured in headless Chrome with the HTTP cache disabled,
against a production `next build` / `next start` of `main` and of this branch in
the same environment (see the front-door report for the method):

| Route | main | after | change |
| --- | --- | --- | --- |
| `/sign-in` | 301.8 KB | 336.2 KB | +34.4 KB |
| `/sign-up` | 292.1 KB | 327.0 KB | +34.9 KB |
| `/marketplace` | 243.6 KB | 279.5 KB | +35.9 KB |
| `/forgot-password` | 290.9 KB | 325.9 KB | +35.0 KB |
| `/two-factor/verify` | 259.5 KB | 294.9 KB | +35.4 KB |

The whole set of 58 icons the app uses arrives as one shared chunk of about
160 KB uncompressed, 36 KB compressed, and every page loads it. Two things
cause that, and neither is a wildcard import:

1. **Phosphor carries six weights per icon.** One `House` component contains
   thin, light, regular, bold, fill and duotone path data, because the weight is
   a prop rather than a separate component. Only three weights are used here, but
   the other three cannot be dropped from the package's own module.
2. **The chunk is shared, not per route.** The icons are imported by the auth
   forms, the shadcn primitives and the design guide, so the build hoists them
   into a chunk common to every entry, and a page that uses two icons still
   loads the union. Splitting the set into one module per icon was tried and
   measured: it changed nothing, because the chunking happens above the module.

If that 36 KB ever has to go, the lever is the number of icons in the approved
set, not the import style.
