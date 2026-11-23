"use client"

// The one control on the receipt that needs a browser: printing.

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => {
        window.print()
      }}
      className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
    >
      Print
    </button>
  )
}
