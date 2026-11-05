import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyResendSignature, parseAddressHeader } from "../resend-inbound";

// Build a valid Svix signature the way Resend/Svix does, so we can test the verifier
// end-to-end without a live webhook.
const KEY_BYTES = crypto.randomBytes(24);
const SECRET = `whsec_${KEY_BYTES.toString("base64")}`;

function sign(id: string, tsSeconds: number, body: string): string {
  const signed = `${id}.${tsSeconds}.${body}`;
  const sig = crypto.createHmac("sha256", KEY_BYTES).update(signed).digest("base64");
  return `v1,${sig}`;
}

describe("verifyResendSignature", () => {
  const id = "msg_2abc";
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ type: "email.received", data: { email_id: "x" } });

  it("accepts a correctly signed request", () => {
    const signature = sign(id, now, body);
    expect(verifyResendSignature(body, { id, timestamp: String(now), signature }, SECRET)).toBe(true);
  });

  it("accepts when the header carries multiple space-separated signatures", () => {
    const signature = `v1,ZZZwrong ${sign(id, now, body).replace("v1,", "v1,")}`;
    expect(verifyResendSignature(body, { id, timestamp: String(now), signature }, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign(id, now, body);
    expect(verifyResendSignature(body + "x", { id, timestamp: String(now), signature }, SECRET)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const signature = sign(id, now, body);
    const other = `whsec_${crypto.randomBytes(24).toString("base64")}`;
    expect(verifyResendSignature(body, { id, timestamp: String(now), signature }, other)).toBe(false);
  });

  it("rejects a stale timestamp (replay protection)", () => {
    const old = now - 60 * 60; // 1 hour ago
    const signature = sign(id, old, body);
    expect(verifyResendSignature(body, { id, timestamp: String(old), signature }, SECRET)).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(verifyResendSignature(body, { id: null, timestamp: null, signature: null }, SECRET)).toBe(false);
  });
});

describe("parseAddressHeader", () => {
  it("parses 'Name <addr>'", () => {
    expect(parseAddressHeader("Jane Broker <Jane@Acme.com>")).toEqual({ email: "jane@acme.com", name: "Jane Broker" });
  });
  it("parses a quoted display name", () => {
    expect(parseAddressHeader('"Broker, Jane" <jane@acme.com>')).toEqual({ email: "jane@acme.com", name: "Broker, Jane" });
  });
  it("parses a bare address", () => {
    expect(parseAddressHeader("jane@acme.com")).toEqual({ email: "jane@acme.com" });
  });
  it("handles undefined", () => {
    expect(parseAddressHeader(undefined)).toEqual({ email: "" });
  });
});
