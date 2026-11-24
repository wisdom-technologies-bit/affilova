import { describe, expect, it } from "vitest"

import { namesMatch, normaliseName } from "./name-match"

// Table driven, with the shapes Nigerian bank records actually carry: surname
// first, extra middle names, a title in front, and initials.

describe("normaliseName", () => {
  it("lowercases, strips punctuation and drops honorifics", () => {
    expect(normaliseName("  Chief Dr. Adaeze O'Brien-Okonkwo ")).toEqual([
      "adaeze",
      "obrien",
      "okonkwo",
    ])
  })

  it("folds accents", () => {
    expect(normaliseName("Chimène Nwósú")).toEqual(["chimene", "nwosu"])
  })

  it("returns nothing for an empty or punctuation-only name", () => {
    expect(normaliseName("")).toEqual([])
    expect(normaliseName("  -  ")).toEqual([])
    expect(normaliseName("Mr")).toEqual([])
  })
})

describe("namesMatch", () => {
  const cases: Array<[string, string, boolean, string]> = [
    ["Adaeze Okonkwo", "OKONKWO ADAEZE CHINWE", true, "surname first and a middle name"],
    ["Mohammed Bello", "BELLO MOHAMMED", true, "the two names in the other order"],
    ["Adaeze C. Okonkwo", "ADAEZE OKONKWO", true, "a middle initial"],
    ["Adaeze Okonkwo", "ADAEZE OKONKWO", true, "identical"],
    ["Chief Adaeze Okonkwo", "ADAEZE OKONKWO", true, "an honorific in front"],
    ["Alhaji Mohammed Bello", "Bello Mohammed", true, "a title and a swap"],
    ["Adaeze Okonkwo", "Adaeze Bello", false, "one shared token only"],
    ["Adaeze Okonkwo", "Chinwe Bello", false, "nothing in common"],
    ["Adaeze", "ADAEZE OKONKWO", true, "a one word profile against a full bank name"],
    ["Okonkwo", "Adaeze Okonkwo", true, "a one word bank name"],
    ["A. Okonkwo", "ADAEZE OKONKWO", false, "an initial is not the name"],
    ["", "ADAEZE OKONKWO", false, "empty profile name"],
    ["Adaeze Okonkwo", "", false, "empty bank name"],
    ["   ", "   ", false, "two blank names"],
  ]

  for (const [profile, resolved, expected, why] of cases) {
    it(`${expected ? "matches" : "refuses"}: ${profile || "(blank)"} / ${resolved || "(blank)"} (${why})`, () => {
      expect(namesMatch(profile, resolved)).toBe(expected)
    })
  }
})
