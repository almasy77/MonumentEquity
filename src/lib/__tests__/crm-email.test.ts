import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  parsePersonName,
  guessCompanyFromEmail,
  extractParticipants,
  selectExternalParticipants,
  buildEmailLog,
} from "../crm-email";
import { isInternalAddress, type CrmEmailSettings } from "../crm-settings";

const SETTINGS: CrmEmailSettings = {
  staffEmails: ["bfrank@monumentequity.com", "bryan.j.frank@gmail.com"],
  staffDomains: [],
  inboundAddress: "crm@monumentequity.com",
  autoCreate: false,
};

describe("staff / internal detection", () => {
  it("treats configured staff emails as internal (case-insensitive)", () => {
    expect(isInternalAddress("BFrank@MonumentEquity.com", SETTINGS)).toBe(true);
    expect(isInternalAddress("bryan.j.frank@gmail.com", SETTINGS)).toBe(true);
  });
  it("treats the inbound/BCC address as internal", () => {
    expect(isInternalAddress("crm@monumentequity.com", SETTINGS)).toBe(true);
  });
  it("treats an external broker as NOT internal", () => {
    expect(isInternalAddress("jane@acmerealty.com", SETTINGS)).toBe(false);
  });
  it("honors a staff domain when configured", () => {
    const s = { ...SETTINGS, staffDomains: ["monumentequity.com"] };
    expect(isInternalAddress("anyone@monumentequity.com", s)).toBe(true);
    expect(isInternalAddress("anyone@gmail.com", s)).toBe(false);
  });
});

describe("participant extraction", () => {
  const payload = {
    FromFull: { Email: "Jane@AcmeRealty.com", Name: "Jane Broker" },
    ToFull: [
      { Email: "bfrank@monumentequity.com", Name: "Bryan Frank" },
      { Email: "crm@monumentequity.com", Name: "CRM" },
    ],
    CcFull: [{ Email: "paul@seller-llc.com", Name: "Paul Seller" }],
  };

  it("collects From + To + Cc, lowercased and deduped", () => {
    const parts = extractParticipants(payload);
    const emails = parts.map((p) => p.email).sort();
    expect(emails).toEqual([
      "bfrank@monumentequity.com",
      "crm@monumentequity.com",
      "jane@acmerealty.com",
      "paul@seller-llc.com",
    ]);
  });

  it("selects only external parties (drops staff + inbound address)", () => {
    const external = selectExternalParticipants(extractParticipants(payload), SETTINGS);
    expect(external.map((p) => p.email).sort()).toEqual([
      "jane@acmerealty.com",
      "paul@seller-llc.com",
    ]);
  });

  it("falls back to From/FromName when FromFull is absent", () => {
    const parts = extractParticipants({ From: "x@y.com", FromName: "X Y" });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ email: "x@y.com", name: "X Y" });
  });
});

describe("name + company parsing", () => {
  it("splits a display name into first / last", () => {
    expect(parsePersonName("Jane Broker", "j@x.com")).toMatchObject({ first_name: "Jane", last_name: "Broker" });
  });
  it("handles 'Last, First'", () => {
    expect(parsePersonName("Broker, Jane", "j@x.com")).toMatchObject({ first_name: "Jane", last_name: "Broker" });
  });
  it("derives a name from the email local part when no name is given", () => {
    expect(parsePersonName(undefined, "jane.doe@acme.com")).toMatchObject({ first_name: "Jane", last_name: "Doe" });
  });
  it("guesses company from a business domain, not freemail", () => {
    expect(guessCompanyFromEmail("jane@acme-realty.com")).toBe("Acme Realty");
    expect(guessCompanyFromEmail("jane@gmail.com")).toBeUndefined();
  });
});

describe("email log building", () => {
  it("builds a log with snippet, normalized addresses and a stable sent_at", () => {
    const log = buildEmailLog({
      messageId: "<abc@mail>",
      subject: "3677 Indianola — offer",
      from: "Jane@AcmeRealty.com",
      fromName: "Jane Broker",
      to: ["BFrank@monumentequity.com"],
      cc: ["Paul@Seller-LLC.com"],
      textBody: "  Hi Bryan,\n\nHere is the package.  ",
      dateHeader: "Tue, 03 Nov 2026 10:00:00 -0500",
      receivedAt: "2026-11-04T00:00:00.000Z",
    });
    expect(log.from).toBe("jane@acmerealty.com");
    expect(log.to).toEqual(["bfrank@monumentequity.com"]);
    expect(log.cc).toEqual(["paul@seller-llc.com"]);
    expect(log.snippet).toContain("Here is the package");
    expect(log.sent_at).toBe("2026-11-03T15:00:00.000Z"); // -05:00 → UTC
    expect(log.message_id).toBe("<abc@mail>");
    expect(log.contact_ids).toEqual([]);
  });

  it("falls back to received_at when the Date header is missing/invalid", () => {
    const log = buildEmailLog({ subject: "s", from: "a@b.com", to: [], cc: [], textBody: "x", dateHeader: "not-a-date", receivedAt: "2026-11-04T00:00:00.000Z" });
    expect(log.sent_at).toBe("2026-11-04T00:00:00.000Z");
  });

  it("strips HTML when there is no text body", () => {
    const log = buildEmailLog({ subject: "s", from: "a@b.com", to: [], cc: [], textBody: "", htmlBody: "<p>Hello <b>world</b></p>", receivedAt: "2026-11-04T00:00:00.000Z" });
    expect(log.text_body).toBe("Hello world");
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases; empty on nullish", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normalizeEmail(undefined)).toBe("");
  });
});
