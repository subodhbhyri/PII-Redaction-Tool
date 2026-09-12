import { faker } from "@faker-js/faker";
import { PiiSpan, PiiType } from "./types";

/** Normalizes a matched value so that trivial variants (extra whitespace, case) map to the
 * same fake replacement. Company/person names in this document sometimes appear in ALL CAPS in
 * one spot and Title Case in another — normalizing avoids two different fakes for one entity. */
function normalizeKey(type: PiiType, value: string): string {
  return `${type}::${value.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export class FakeMapper {
  private map = new Map<string, string>();
  // Track used fakes per-type so we don't accidentally hand out the same fake value to two
  // different real entities of the same type.
  private used = new Map<PiiType, Set<string>>();

  private isUsed(type: PiiType, value: string): boolean {
    return this.used.get(type)?.has(value) ?? false;
  }
  private markUsed(type: PiiType, value: string) {
    if (!this.used.has(type)) this.used.set(type, new Set());
    this.used.get(type)!.add(value);
  }

  getFake(span: PiiSpan): string {
    const key = normalizeKey(span.type, span.value);
    const existing = this.map.get(key);
    if (existing) return existing;

    let fake = this.generate(span.type, span.value);
    let guard = 0;
    while (this.isUsed(span.type, fake) && guard < 20) {
      fake = this.generate(span.type, span.value);
      guard++;
    }
    this.map.set(key, fake);
    this.markUsed(span.type, fake);
    return fake;
  }

  private generate(type: PiiType, original: string): string {
    switch (type) {
      case "PERSON": {
        const isAllCaps = original === original.toUpperCase();
        const name = `${faker.person.firstName()} ${faker.person.lastName()}`;
        return isAllCaps ? name.toUpperCase() : name;
      }
      case "EMAIL":
        return faker.internet.email().toLowerCase();
      case "PHONE": {
        // Preserve a leading "+CC " country-code style prefix if the original had one, so the
        // fake still looks structurally like the source (helps a reader sanity-check format).
        const ccMatch = original.match(/^\+\s?\d{1,3}/);
        const digits = faker.string.numeric(10);
        return ccMatch ? `${ccMatch[0]} ${digits}` : faker.phone.number();
      }
      case "COMPANY":
        return faker.company.name();
      case "ADDRESS":
        return `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state()} ${faker.location.zipCode()}, India`;
      case "SSN":
        return faker.helpers.replaceSymbols("###-##-####");
      case "CREDIT_CARD":
        return faker.finance.creditCardNumber();
      case "DOB":
        return faker.date.birthdate().toISOString().slice(0, 10);
      case "IP_ADDRESS":
        return faker.internet.ip();
      default:
        return "[REDACTED]";
    }
  }
}
