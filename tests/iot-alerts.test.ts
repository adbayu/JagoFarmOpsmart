import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateThreshold } from "../src/modules/iot/alerts.js";
import { alertConfigInputSchema } from "../src/modules/iot/contracts.js";

const disabled = {
  unit: "degC",
  low: null,
  high: null,
  staleAfterSeconds: null,
};

test("threshold boundaries are strict and recover at equality", () => {
  const config = { low: "18.5", high: "30" };
  assert.equal(evaluateThreshold("18.499999", config), "LOW");
  assert.equal(evaluateThreshold("18.5", config), null);
  assert.equal(evaluateThreshold("30", config), null);
  assert.equal(evaluateThreshold("30.000001", config), "HIGH");
});

test("single-sided and disabled thresholds are supported", () => {
  assert.equal(evaluateThreshold("17", { low: "18", high: null }), "LOW");
  assert.equal(evaluateThreshold("19", { low: "18", high: null }), null);
  assert.equal(evaluateThreshold("-999", { low: null, high: null }), null);
  assert.equal(evaluateThreshold("999", { low: null, high: "30" }), "HIGH");
});

test("threshold comparison keeps six-decimal precision and large values exact", () => {
  assert.equal(
    evaluateThreshold("100000000000.000000", {
      low: null,
      high: "100000000000.000001",
    }),
    null,
  );
  assert.equal(
    evaluateThreshold("100000000000.000002", {
      low: null,
      high: "100000000000.000001",
    }),
    "HIGH",
  );
  assert.equal(evaluateThreshold("-0.000001", { low: "0", high: null }), "LOW");
});

test("alert config accepts disabled and optional-sided thresholds", () => {
  assert.deepEqual(alertConfigInputSchema.parse(disabled), disabled);
  assert.deepEqual(
    alertConfigInputSchema.parse({
      unit: "ppm",
      low: null,
      high: "250.000001",
      staleAfterSeconds: 60,
    }),
    {
      unit: "ppm",
      low: null,
      high: "250.000001",
      staleAfterSeconds: 60,
    },
  );
});

test("alert config rejects mixed units, unordered bounds, and invalid decimals", () => {
  assert.equal(
    alertConfigInputSchema.safeParse({ ...disabled, unit: "deg C" }).success,
    false,
  );
  assert.equal(
    alertConfigInputSchema.safeParse({
      ...disabled,
      low: "30",
      high: "18",
    }).success,
    false,
  );
  assert.equal(
    alertConfigInputSchema.safeParse({ ...disabled, low: 18 }).success,
    false,
  );
  assert.equal(
    alertConfigInputSchema.safeParse({ ...disabled, high: "01.0" }).success,
    false,
  );
  assert.equal(
    alertConfigInputSchema.safeParse({ ...disabled, unexpected: true }).success,
    false,
  );
});

test("stale timeout is either disabled or within the approved range", () => {
  for (const staleAfterSeconds of [60, 7_776_000, null]) {
    assert.equal(
      alertConfigInputSchema.safeParse({ ...disabled, staleAfterSeconds })
        .success,
      true,
    );
  }
  for (const staleAfterSeconds of [59, 7_776_001, 1.5]) {
    assert.equal(
      alertConfigInputSchema.safeParse({ ...disabled, staleAfterSeconds })
        .success,
      false,
    );
  }
});
