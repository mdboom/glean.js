/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "assert";
import sinon from "sinon";

import { Context } from "../../../src/core/context";
import Glean from "../../../src/core/glean";
import { Lifetime } from "../../../src/core/metrics/lifetime";
import TimeUnit from "../../../src/core/metrics/time_unit";
import TimespanMetricType, { TimespanMetric } from "../../../src/core/metrics/types/timespan";

const sandbox = sinon.createSandbox();

describe("TimespanMetric", function() {
  const testAppId = `gleanjs.test.${this.title}`;

  beforeEach(async function() {
    await Glean.testResetGlean(testAppId);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("timespan internal representation validation works as expected", function () {
    // Invalid objects
    assert.throws(() => new TimespanMetric(undefined));
    assert.throws(() => new TimespanMetric(null));
    assert.throws(() => new TimespanMetric({}));
    assert.throws(() => new TimespanMetric({ rubbish: "garbage" }));
    assert.throws(() => new TimespanMetric({ rubbish: "garbage", timeUnit: "milliseconds" }));

    // Invalid time units
    assert.throws(() => new TimespanMetric({ timeUnit: "garbage", timespan: 10 }));
    assert.throws(() => new TimespanMetric({ timeUnit: null, timespan: 10 }));
    assert.throws(() => new TimespanMetric({ timeUnit: "hour" }));

    // Invalid timespans
    assert.throws(() => new TimespanMetric({ timeUnit: "hour", timespan: -300 }));
    assert.throws(() => new TimespanMetric({ timeUnit: "hour", timespan: "aaaaaaaaaaaaaaaaaaaaaaaa" }));
    assert.throws(() => new TimespanMetric({ timespan: 10 }));

    // Valid values
    assert.doesNotThrow(() => new TimespanMetric({ timeUnit: "millisecond", timespan: 300 }));
  });

  it("attempting to get the value of a metric that hasn't been recorded doesn't error", async function() {
    const metric = new TimespanMetricType({
      category: "aCategory",
      name: "aTimespan",
      sendInPings: ["aPing", "twoPing", "threePing"],
      lifetime: Lifetime.Ping,
      disabled: false
    }, "millisecond");

    assert.strictEqual(await metric.testGetValue("aPing"), undefined);
  });

  it("attempting to start/stop when glean upload is disabled is a no-op", async function() {
    Glean.setUploadEnabled(false);

    const metric = new TimespanMetricType({
      category: "aCategory",
      name: "aTimespan",
      sendInPings: ["aPing", "twoPing", "threePing"],
      lifetime: Lifetime.Ping,
      disabled: false
    }, "millisecond");

    metric.start();
    metric.stop();

    assert.strictEqual(await metric.testGetValue("aPing"), undefined);
  });

  it("ping payload is correct", async function() {
    const fakeDateNow = performance ? sandbox.stub(performance, "now") : sandbox.stub(Date, "now");
    fakeDateNow.onCall(0).callsFake(() => 0);
    fakeDateNow.onCall(1).callsFake(() => 100);

    const metric = new TimespanMetricType({
      category: "aCategory",
      name: "aTimespan",
      sendInPings: ["aPing"],
      lifetime: Lifetime.Ping,
      disabled: false
    }, "millisecond");

    metric.start();
    metric.stop();
    assert.strictEqual(await metric.testGetValue("aPing"), 100);

    const snapshot = await Context.metricsDatabase.getPingMetrics("aPing", true);
    assert.deepStrictEqual(snapshot, {
      "timespan": {
        "aCategory.aTimespan": 100
      }
    });
  });

  it("recording APIs properly sets the value in all pings", async function() {
    const fakeDateNow = performance ? sandbox.stub(performance, "now") : sandbox.stub(Date, "now");
    fakeDateNow.onCall(0).callsFake(() => 0);
    fakeDateNow.onCall(1).callsFake(() => 100);

    const metric = new TimespanMetricType({
      category: "aCategory",
      name: "aTimespan",
      sendInPings: ["aPing", "twoPing", "threePing"],
      lifetime: Lifetime.Ping,
      disabled: false
    }, "millisecond");

    metric.start();
    metric.stop();
    assert.strictEqual(await metric.testGetValue("aPing"), 100);
    assert.strictEqual(await metric.testGetValue("twoPing"), 100);
    assert.strictEqual(await metric.testGetValue("threePing"), 100);
  });

  it("truncation works", async function() {
    const testCases = [
      {
        unit: TimeUnit.Nanosecond,
        expected: 3600000000000,
      },
      {
        unit: TimeUnit.Microsecond,
        expected: 3600000000,
      },
      {
        unit: TimeUnit.Millisecond,
        expected: 3600000,
      },
      {
        unit: TimeUnit.Second,
        expected: 3600,
      },
      {
        unit: TimeUnit.Minute,
        expected: 60,
      },
      {
        unit: TimeUnit.Hour,
        expected: 1,
      },
      {
        unit: TimeUnit.Day,
        expected: 0,
      },
    ];

    for (const testCase of testCases) {
      const fakeDateNow = performance ? sandbox.stub(performance, "now") : sandbox.stub(Date, "now");
      fakeDateNow.onCall(0).callsFake(() => 0);
      fakeDateNow.onCall(1).callsFake(() => 3600000); // One hour.

      const metric = new TimespanMetricType({
        category: "aCategory",
        name: `aDatetimeMetric_${testCase.unit}`,
        sendInPings: ["aPing"],
        lifetime: Lifetime.Ping,
        disabled: false
      }, testCase.unit);

      metric.start();
      metric.stop();
      assert.strictEqual(await metric.testGetValue("aPing"), testCase.expected);

      sandbox.restore();
    }
  });

  it("second timer run is skipped", async function() {
    const fakeDateNow = performance ? sandbox.stub(performance, "now") : sandbox.stub(Date, "now");
    // First check, duration: 100
    fakeDateNow.onCall(0).callsFake(() => 0);
    fakeDateNow.onCall(1).callsFake(() => 100);
    // Second check, duration 99
    fakeDateNow.onCall(2).callsFake(() => 101);
    fakeDateNow.onCall(3).callsFake(() => 200);

    // TODO: check number of recorded errors instead once Bug 1682574 is resolved.
    const consoleErrorSpy = sandbox.spy(console, "error");

    const metric = new TimespanMetricType({
      category: "aCategory",
      name: "aTimespan",
      sendInPings: ["aPing"],
      lifetime: Lifetime.Ping,
      disabled: false
    }, "millisecond");

    metric.start();
    metric.stop();
    assert.strictEqual(await metric.testGetValue("aPing"), 100);

    // No error should be logged here: we had no prior value stored.
    assert.deepStrictEqual(consoleErrorSpy.callCount, 0);

    metric.start();
    metric.stop();
    // First value should not be overwritten
    assert.strictEqual(await metric.testGetValue("aPing"), 100);

    // Make sure that the error has been logged: we had a stored value,
    // the new measurement was dropped.
    assert.deepStrictEqual(consoleErrorSpy.callCount, 1);
  });

  it("cancel does not store and clears start time", async function() {
    const metric = new TimespanMetricType({
      category: "aCategory",
      name: "aTimespan",
      sendInPings: ["aPing"],
      lifetime: Lifetime.Ping,
      disabled: false
    }, "millisecond");

    metric.start();
    metric.cancel();
    assert.strictEqual(await metric.testGetValue("aPing"), undefined);
    assert.strictEqual(metric["startTime"], undefined);
  });

  it("nothing is stored before stop", async function() {
    const fakeDateNow = performance ? sandbox.stub(performance, "now") : sandbox.stub(Date, "now");
    fakeDateNow.onCall(0).callsFake(() => 0);
    fakeDateNow.onCall(1).callsFake(() => 100);

    const metric = new TimespanMetricType({
      category: "aCategory",
      name: "aTimespan",
      sendInPings: ["aPing"],
      lifetime: Lifetime.Ping,
      disabled: false
    }, "millisecond");

    metric.start();
    assert.strictEqual(await metric.testGetValue("aPing"), undefined);

    metric.stop();
    assert.strictEqual(await metric.testGetValue("aPing"), 100);
  });

  it("timespan is not tracked across upload toggle", async function() {
    const metric = new TimespanMetricType({
      category: "aCategory",
      name: "aTimespan",
      sendInPings: ["aPing"],
      lifetime: Lifetime.Ping,
      disabled: false
    }, "millisecond");

    // Timer is started.
    metric.start();
    // User disables telemetry upload.
    Glean.setUploadEnabled(false);
    // App code eventually stops the timer.
    // We should clear internal state as upload is disabled.
    metric.stop();

    // App code eventually starts the timer again.
    // Upload is disabled, so this should not have any effect.
    metric.start();
    // User enables telemetry upload again.
    Glean.setUploadEnabled(true);
    // App code eventually stops the timer.
    // None should be running.
    metric.stop();

    // Nothing should have been recorded.
    assert.strictEqual(await metric.testGetValue("aPing"), undefined);

    // TODO: Make sure also incalid state error was recorded.
  });

  it("time cannot go backwards", async function() {
    const fakeDateNow = performance ? sandbox.stub(performance, "now") : sandbox.stub(Date, "now");
    fakeDateNow.onCall(0).callsFake(() => 100);
    fakeDateNow.onCall(1).callsFake(() => 0);

    const metric = new TimespanMetricType({
      category: "aCategory",
      name: "aTimespan",
      sendInPings: ["aPing"],
      lifetime: Lifetime.Ping,
      disabled: false
    }, "millisecond");

    // TODO: check number of recorded errors instead once Bug 1682574 is resolved.
    const consoleErrorSpy = sandbox.spy(console, "error");

    metric.start();
    metric.stop();
    assert.strictEqual(await metric.testGetValue("aPing"), undefined);

    assert.deepStrictEqual(consoleErrorSpy.callCount, 1);
  });
});
