import { describe, expect, it } from "vitest"

import { takeChosenFiles, type FileInputTarget } from "./file-input"

// The bug this file exists for: `input.files` is live, so resetting the input
// before reading the list left every upload with nothing to send. These tests
// use a fake input that empties itself the way a browser does.

function makeFile(name: string): File {
  return new File(["contents"], name, { type: "application/pdf" })
}

/** An input whose file list empties when its value is reset, as in a browser. */
function makeLiveInput(files: File[]): FileInputTarget & {
  list: File[]
  choose: (next: File[]) => void
} {
  const state = { list: files.slice() }

  return {
    get list() {
      return state.list
    },
    choose(next: File[]) {
      state.list = next.slice()
    },
    get files() {
      return state.list
    },
    set value(next: string) {
      if (next === "") {
        state.list = []
      }
    },
    get value() {
      return ""
    },
  }
}

describe("takeChosenFiles", () => {
  it("returns the chosen files and clears the input", () => {
    const input = makeLiveInput([makeFile("guide.pdf")])

    const chosen = takeChosenFiles(input)

    expect(chosen).toHaveLength(1)
    expect(chosen[0]?.name).toBe("guide.pdf")
    expect(input.list).toHaveLength(0)
  })

  it("keeps the files even though the input is live and emptied", () => {
    const input = makeLiveInput([makeFile("a.pdf"), makeFile("b.pdf")])

    const chosen = takeChosenFiles(input)

    // The input is empty by now; the copy is not. This is the regression the
    // old one-liner hit: it handed an already empty list to the upload.
    expect(input.files).toHaveLength(0)
    expect(chosen.map((file) => file.name)).toEqual(["a.pdf", "b.pdf"])
  })

  it("answers an empty array for a cancelled picker", () => {
    const input = makeLiveInput([])

    expect(takeChosenFiles(input)).toEqual([])
  })

  it("answers an empty array when the browser has no file list", () => {
    const input: FileInputTarget = { files: null, value: "" }

    expect(takeChosenFiles(input)).toEqual([])
  })

  it("allows the same file to be chosen twice", () => {
    const input = makeLiveInput([makeFile("cover.png")])

    expect(takeChosenFiles(input)).toHaveLength(1)

    // The reset is what makes the second choice possible at all.
    input.value = ""
    input.choose([makeFile("cover.png")])

    expect(takeChosenFiles(input)).toHaveLength(1)
  })
})
