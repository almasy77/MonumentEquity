/**
 * SSRF guard for user-supplied import URLs. Blocks non-http(s) schemes and IP
 * literals in private/loopback/link-local/reserved ranges (incl. the cloud
 * metadata endpoint 169.254.169.254). Hostname→DNS cases need the network, so
 * these cover schemes + IP-literal classification, which is the core logic.
 */
import { describe, it, expect } from "vitest";
import { assertPublicHttpUrl } from "../ssrf";

describe("assertPublicHttpUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    for (const u of ["file:///etc/passwd", "gopher://x", "ftp://x/y", "data:text/html,x"]) {
      await expect(assertPublicHttpUrl(u)).rejects.toThrow();
    }
  });

  it("blocks private / loopback / link-local / reserved IPv4 literals", async () => {
    const blocked = [
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://127.0.0.1/", "http://127.5.6.7/", "http://0.0.0.0/",
      "http://10.0.0.5/", "http://172.16.0.1/", "http://172.31.255.255/",
      "http://192.168.1.1/", "http://100.64.0.1/", "http://198.18.0.1/",
      "http://224.0.0.1/", "http://240.0.0.1/",
    ];
    for (const u of blocked) {
      await expect(assertPublicHttpUrl(u)).rejects.toThrow(/non-public/);
    }
  });

  it("blocks IPv6 loopback / link-local / unique-local and mapped-v4", async () => {
    for (const u of ["http://[::1]/", "http://[fe80::1]/", "http://[fc00::1]/", "http://[fd12::1]/", "http://[::ffff:127.0.0.1]/"]) {
      await expect(assertPublicHttpUrl(u)).rejects.toThrow(/non-public/);
    }
  });

  it("allows a normal public IPv4 literal", async () => {
    const u = await assertPublicHttpUrl("http://93.184.216.34/listing"); // example.com's IP range (public)
    expect(u.protocol).toBe("http:");
  });

  it("rejects a malformed URL", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow();
  });
});
