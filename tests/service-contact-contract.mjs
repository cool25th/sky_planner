import assert from "node:assert/strict";
import test from "node:test";

import { resolveSupportContact } from "../lib/service-contact.ts";

test("support contact resolver accepts a production-shaped support email", () => {
  const contact = resolveSupportContact({
    SUPPORT_EMAIL: "support@skyplanner.co.kr",
  });

  assert.equal(contact.ok, true);
  assert.equal(contact.email, "support@skyplanner.co.kr");
  assert.equal(contact.env_name, "SUPPORT_EMAIL");
  assert.equal(contact.host, "skyplanner.co.kr");
});

test("support contact resolver rejects missing, invalid, and placeholder email hosts", () => {
  assert.equal(resolveSupportContact({}).reason, "missing");
  assert.equal(resolveSupportContact({ SUPPORT_EMAIL: "not-an-email" }).reason, "invalid_email");
  assert.equal(resolveSupportContact({ SUPPORT_EMAIL: "support@example.com" }).reason, "placeholder_email_host");
  assert.equal(resolveSupportContact({ NEXT_PUBLIC_SUPPORT_EMAIL: "support@help.example.org" }).reason, "placeholder_email_host");
});
