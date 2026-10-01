/**
 * P3-11: the comps market index key. The read path used sanitizeKeySegment (which
 * strips spaces) while the write path used the raw lowercased city, so a multi-word
 * city ("West View") was written under "west view" but read under "westview" and
 * returned nothing. compMarketKey is the single shared derivation; this pins its
 * output and that spaces survive.
 */
import { describe, it, expect } from "vitest";
import { compMarketKey, sanitizeKeySegment } from "../api-helpers";

describe("P3-11: compMarketKey keeps multi-word cities intact", () => {
  it("preserves spaces (the old sanitize path dropped them)", () => {
    expect(compMarketKey("West View")).toBe("comps:by_market:west view");
    expect(compMarketKey("Upper Arlington")).toBe("comps:by_market:upper arlington");
    expect(compMarketKey("Mt. Lebanon")).toBe("comps:by_market:mt. lebanon");
    // The old read key dropped the space -> never matched the written key.
    expect(`comps:by_market:${sanitizeKeySegment("West View".toLowerCase())}`).toBe("comps:by_market:westview");
  });

  it("is case- and whitespace-insensitive so read and write always agree", () => {
    expect(compMarketKey("  west view ")).toBe(compMarketKey("West View"));
    expect(compMarketKey("WEST  VIEW")).toBe(compMarketKey("West View"));
    expect(compMarketKey("Pittsburgh")).toBe("comps:by_market:pittsburgh");
  });
});
