import { describe, expect, test } from "bun:test";
import { buildPermitsBuyerSummary, classifyCodeEnforcement, parsePermitRows } from "./permits.ts";

describe("classifyCodeEnforcement", () => {
  test("flags PortlandMaps enforcement permit labels", () => {
    expect(classifyCodeEnforcement("Enforcement: Housing")).toBe(true);
    expect(classifyCodeEnforcement("Enforcement: Construction Code")).toBe(true);
    expect(classifyCodeEnforcement("Facility Permit", "Electrical")).toBe(false);
  });
});

describe("parsePermitRows", () => {
  test("reads permits detail `related` array", () => {
    const raw = {
      related: [
        {
          permit: "Facility Permit",
          application_number: "2019-178633-000-00-FA",
          type: "Fire Alarms",
          work: "Alteration",
          status: "Final Inspection Approved",
          last_action: "June, 26 2019 06:48:03",
          ivr_number: "4409177",
          address: "111 SW 5TH AVE",
        },
        {
          permit: "Enforcement: Nuisance",
          application_number: "2020-000001-000-00-XX",
          type: "Case",
          work: "Other",
          status: "Open",
          last_action: "Jan, 01 2020 00:00:00",
          ivr_number: 1234567,
          address: "222 EXAMPLE ST",
        },
      ],
    };
    const rows = parsePermitRows(raw);
    expect(rows.length).toBe(2);
    expect(rows[0]!.permitLabel).toBe("Facility Permit");
    expect(rows[0]!.isCodeEnforcement).toBe(false);
    expect(rows[1]!.isCodeEnforcement).toBe(true);
    expect(rows[1]!.ivrNumber).toBe("1234567");
  });
});

describe("buildPermitsBuyerSummary", () => {
  test("mentions enforcement when flagged rows exist", () => {
    const rows = parsePermitRows({
      related: [{ permit: "Enforcement: Housing", type: "X", status: "Closed", ivr_number: "1" }],
    });
    const s = buildPermitsBuyerSummary(rows, "1 Main St");
    expect(s).toContain("1 Main St");
    expect(s.toLowerCase()).toContain("enforcement");
  });
});
