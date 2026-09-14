import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anonymizeJson, anonymizeText, visiblePersonName } from "./anonymize.ts";

describe("anonymizeText", () => {
  it("keeps location after Symea", () => {
    assert.equal(anonymizeText("Symea Shanghai"), "Shanghai");
  });

  it("rewrites email domains", () => {
    assert.equal(anonymizeText("olivier@syskern.com"), "olivier@exemple.com");
  });

  it("keeps engine identifiers", () => {
    assert.equal(anonymizeText("syskern"), "syskern");
    assert.equal(anonymizeText("symea"), "symea");
  });

  it("strips display names", () => {
    assert.equal(anonymizeText("Syskern"), "—");
    assert.equal(anonymizeText("Unikkern"), "—");
  });
});

describe("anonymizeJson", () => {
  it("leaves keys intact", () => {
    const out = anonymizeJson({
      syskern_margin_rate: "0.20",
      supplier_name: "Symea Shanghai",
      brand: "unikkern",
    });
    assert.equal(out.syskern_margin_rate, "0.20");
    assert.equal(out.supplier_name, "Shanghai");
    assert.equal(out.brand, "—");
  });
});

describe("visiblePersonName", () => {
  it("drops a stripped last name", () => {
    assert.equal(
      visiblePersonName({ first_name: "Olivier", last_name: "—", email: "olivier@exemple.com" }),
      "Olivier",
    );
  });
});
