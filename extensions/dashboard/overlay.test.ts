import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { INSPECTION_OVERLAY_OPTIONS } from "./overlay.ts";

describe("dashboard inspection overlay layout", () => {
  it("uses a full-screen centered blocking layout", () => {
    assert.equal(INSPECTION_OVERLAY_OPTIONS.anchor, "center");
    assert.equal(INSPECTION_OVERLAY_OPTIONS.width, "100%");
    assert.equal(INSPECTION_OVERLAY_OPTIONS.minWidth, 60);
    assert.equal(INSPECTION_OVERLAY_OPTIONS.maxHeight, "100%");
    assert.equal(INSPECTION_OVERLAY_OPTIONS.margin, 0);
  });

  it("is always visible regardless of terminal width", () => {
    assert.equal(INSPECTION_OVERLAY_OPTIONS.visible(40), true);
    assert.equal(INSPECTION_OVERLAY_OPTIONS.visible(80), true);
    assert.equal(INSPECTION_OVERLAY_OPTIONS.visible(160), true);
  });
});
