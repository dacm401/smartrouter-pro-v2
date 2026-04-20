// Smoke test - uses vitest globals (injected by vitest globals:true config)
// deliberately NOT importing from "vitest" to avoid NTFS hardlink dedup issues

describe("smoke", () => {
  it("1+1=2", () => {
    expect(1 + 1).toBe(2);
  });
});

